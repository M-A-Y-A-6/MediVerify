import json
import os
import base64
import time
import sys

try:
    import boto3
    from botocore.exceptions import ClientError
except ImportError:
    print("boto3 is not installed. Please install it using: pip install boto3")
    sys.exit(1)

def load_credentials():
    cred_path = os.path.join(os.path.dirname(__file__), "aws_credentials.json")
    if not os.path.exists(cred_path):
        print(f"Credentials file not found at {cred_path}. Please create it first.")
        sys.exit(1)
    with open(cred_path, "r") as f:
        return json.load(f)

def read_file_as_b64(filepath):
    if not os.path.exists(filepath):
        print(f"Required file not found: {filepath}")
        sys.exit(1)
    with open(filepath, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

def get_latest_ubuntu_ami(ssm_client):
    print("Fetching latest Ubuntu 22.04 AMI ID...")
    try:
        parameter = ssm_client.get_parameter(
            Name='/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id'
        )
        ami_id = parameter['Parameter']['Value']
        print(f"Found Ubuntu AMI: {ami_id}")
        return ami_id
    except Exception as e:
        print(f"Failed to fetch AMI via SSM: {e}")
        # Fallback to standard Ubuntu 22.04 AMI in us-east-1
        return "ami-053b0d53c279acc90"

def setup_security_group(ec2_client):
    sg_name = "mediverify-sg"
    print(f"Setting up security group: {sg_name}...")
    try:
        # Create security group
        response = ec2_client.create_security_group(
            GroupName=sg_name,
            Description="Security group for MediVerify FastAPI backend server"
        )
        sg_id = response['GroupId']
        print(f"Created Security Group with ID: {sg_id}")

        # Authorize ingress rules (Port 8080 for FastAPI, Port 22 for SSH)
        ec2_client.authorize_security_group_ingress(
            GroupId=sg_id,
            IpPermissions=[
                {
                    'IpProtocol': 'tcp',
                    'FromPort': 8080,
                    'ToPort': 8080,
                    'IpRanges': [{'CidrIp': '0.0.0.0/0', 'Description': 'FastAPI port'}]
                },
                {
                    'IpProtocol': 'tcp',
                    'FromPort': 22,
                    'ToPort': 22,
                    'IpRanges': [{'CidrIp': '0.0.0.0/0', 'Description': 'SSH port'}]
                }
            ]
        )
        print("Authorized ingress traffic on ports 8080 and 22.")
        return sg_id
    except ClientError as e:
        if e.response['Error']['Code'] == 'InvalidGroup.Duplicate':
            # Security group already exists, fetch its ID
            response = ec2_client.describe_security_groups(GroupNames=[sg_name])
            sg_id = response['SecurityGroups'][0]['GroupId']
            print(f"Security Group already exists. Using existing ID: {sg_id}")
            return sg_id
        else:
            print(f"Error setting up Security Group: {e}")
            raise e

def create_user_data():
    print("Preparing User Data payload by base64 encoding backend files...")
    backend_dir = os.path.join(os.path.dirname(__file__), "backend")
    
    main_b64 = read_file_as_b64(os.path.join(backend_dir, "main.py"))
    reqs_b64 = read_file_as_b64(os.path.join(backend_dir, "requirements.txt"))
    data_b64 = read_file_as_b64(os.path.join(backend_dir, "trusted_data.json"))
    docker_b64 = read_file_as_b64(os.path.join(backend_dir, "Dockerfile"))

    # Write a shell script that runs on startup on EC2
    user_data = f"""#!/bin/bash
# Update and install Docker
apt-get update -y
apt-get install -y docker.io

# Create app directory
mkdir -p /app
cd /app

# Write files using base64 decoding
echo "{main_b64}" | base64 -d > main.py
echo "{reqs_b64}" | base64 -d > requirements.txt
echo "{data_b64}" | base64 -d > trusted_data.json
echo "{docker_b64}" | base64 -d > Dockerfile

# Build and run the docker container
systemctl start docker
systemctl enable docker
docker build -t mediverify-backend .
docker run -d --name mediverify-server -p 8080:8080 --restart unless-stopped mediverify-backend
"""
    return user_data

def deploy():
    creds = load_credentials()
    
    # Initialize AWS clients
    session = boto3.Session(
        aws_access_key_id=creds["aws_access_key_id"],
        aws_secret_access_key=creds["aws_secret_access_key"],
        aws_session_token=creds.get("aws_session_token") if "PASTE_SESSION_TOKEN_HERE" not in creds.get("aws_session_token", "") and creds.get("aws_session_token") else None,
        region_name=creds.get("region", "us-east-1")
    )
    
    ec2_client = session.client("ec2")
    ssm_client = session.client("ssm")
    
    # Get AMI and SG
    ami_id = get_latest_ubuntu_ami(ssm_client)
    sg_id = setup_security_group(ec2_client)
    
    # Get user data script
    user_data_script = create_user_data()
    
    print("Launching EC2 instance...")
    try:
        # Launch instance
        response = ec2_client.run_instances(
            ImageId=ami_id,
            InstanceType="t2.micro",  # Free tier eligible
            MinCount=1,
            MaxCount=1,
            SecurityGroupIds=[sg_id],
            UserData=user_data_script,
            TagSpecifications=[
                {
                    'ResourceType': 'instance',
                    'Tags': [{'Key': 'Name', 'Value': 'MediVerify-Backend-Server'}]
                }
            ]
        )
        
        instance_id = response['Instances'][0]['InstanceId']
        print(f"Successfully launched instance: {instance_id}")
        
        # Wait for instance to get a public IP
        print("Waiting for instance to start running and assign IP address...")
        while True:
            desc_response = ec2_client.describe_instances(InstanceIds=[instance_id])
            state = desc_response['Reservations'][0]['Instances'][0]['State']['Name']
            if state == 'running':
                public_ip = desc_response['Reservations'][0]['Instances'][0].get('PublicIpAddress')
                if public_ip:
                    print(f"\nServer is running! Public IP: {public_ip}")
                    return public_ip
            elif state in ['shutting-down', 'terminated']:
                print(f"Instance failed to boot up, state: {state}")
                sys.exit(1)
            
            sys.stdout.write(".")
            sys.stdout.flush()
            time.sleep(5)
            
    except Exception as e:
        print(f"Deployment failed: {e}")
        sys.exit(1)

def update_frontend_env(public_ip):
    env_content = f"VITE_API_URL=http://{public_ip}:8080\n"
    env_path = os.path.join(os.path.dirname(__file__), "frontend", ".env.production")
    
    print(f"Writing environment configuration to {env_path}...")
    with open(env_path, "w") as f:
        f.write(env_content)
    print("Frontend production environment variable updated successfully.")

if __name__ == "__main__":
    ip = deploy()
    update_frontend_env(ip)
    print("\n--- DEPLOYMENT SUCCESSFUL ---")
    print(f"Backend Server Health Endpoint: http://{ip}:8080/")
    print("The mobile app environment is configured. Ready to build the APK!")
