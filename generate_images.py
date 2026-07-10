from PIL import Image, ImageDraw
import os

# Create folder
os.makedirs("demo_images", exist_ok=True)

# Image 1: Plain text saying "Paracetamol 500mg BATCH: PA1023"
img1 = Image.new('RGB', (600, 200), color='#1e293b')
d1 = ImageDraw.Draw(img1)
d1.text((30, 40), "PRESCRIPTION REPORT", fill='#38bdf8')
d1.text((30, 80), "Medicine: Paracetamol 500mg", fill='#f1f5f9')
d1.text((30, 120), "Batch Number: PA1023", fill='#f1f5f9')
d1.text((30, 150), "Status: Dispatched", fill='#64748b')
img1.save("demo_images/1_genuine_paracetamol.png")

# Image 2: Plain text with a batch number not in the trusted list (suspicious)
img2 = Image.new('RGB', (600, 200), color='#1e293b')
d2 = ImageDraw.Draw(img2)
d2.text((30, 40), "CLINICAL LOG REPORT", fill='#f43f5e')
d2.text((30, 80), "Product Name: Aspirin 300mg", fill='#f1f5f9')
d2.text((30, 120), "Batch Number: AS9999", fill='#f1f5f9')
d2.text((30, 150), "Manufacturer: Bayer Care", fill='#64748b')
img2.save("demo_images/2_suspicious_aspirin.png")

# Image 3: Blurry/no readable batch number (unable to verify)
img3 = Image.new('RGB', (600, 200), color='#1e293b')
d3 = ImageDraw.Draw(img3)
d3.text((30, 40), "MEDICAL CERTIFICATE", fill='#e2e8f0')
d3.text((30, 80), "Patient: John Doe", fill='#64748b')
d3.text((30, 120), "B@tCh N#mB: [UNREADABLE BLUR]", fill='#475569')
img3.save("demo_images/3_unreadable_cert.png")

print("Created 3 demo images inside 'demo_images/' folder successfully.")
