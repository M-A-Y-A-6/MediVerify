import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Camera, 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldAlert, 
  Activity, 
  Sparkles, 
  RefreshCw, 
  Image as ImageIcon,
  ChevronRight,
  BarChart3,
  Menu,
  X,
  Send,
  QrCode,
  Award,
  User,
  Settings as SettingsIcon,
  LogOut,
  Bell,
  HelpCircle,
  MessageSquare,
  ChevronDown
} from 'lucide-react';
import { verifyDocument, fetchFlaggedEntries as apiFetchFlaggedEntries, sendChatMessage } from './lib/api';
import { cognitoSignUp, cognitoConfirmSignUp, cognitoResendConfirmationCode, cognitoSignIn, cognitoSignOut } from './lib/auth';
import { isCognitoConfigured, AWS_CONFIG } from './lib/awsConfig';

interface MatchedEntry {
  medicine_name: string;
  batch_number: string;
  manufacturer: string;
  expiry_date: string;
}

interface VerificationResult {
  filename: string;
  format: string;
  dimensions: string;
  size_bytes: number;
  status: string;
  confidence_score: number;
  extracted_fields: {
    patient_name: string;
    provider: string;
    issue_date: string;
    document_type: string;
    details: string;
  };
  analysis_flags: string[];
  timestamp: string;
  raw_text?: string;
  detected_medicine_name?: string;
  detected_batch_number?: string;
  matched_entry?: MatchedEntry | null;
}

function App() {
  // Navigation & Auth States
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => {
    return localStorage.getItem('mediverify_logged_in') === 'true';
  });
  const [currentUser, setCurrentUser] = useState<{name: string, email: string}>({
    name: localStorage.getItem('mediverify_user_name') || 'Dr. Alex Mercer',
    email: localStorage.getItem('mediverify_user_email') || 'alex.mercer@apexhealth.org'
  });
  const [currentScreen, setCurrentScreen] = useState<string>('home');
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [loginEmail, setLoginEmail] = useState<string>('alex.mercer@apexhealth.org');
  const [loginPassword, setLoginPassword] = useState<string>('password123');
  const [signUpName, setSignUpName] = useState<string>('');
  const [signUpEmail, setSignUpEmail] = useState<string>('');
  const [signUpPass, setSignUpPass] = useState<string>('');
  const [confirmCode, setConfirmCode] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(false);
  
  // Scanner States
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMsg, setLoadingMsg] = useState<string>('Uploading image to secure gateway...');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<VerificationResult[]>([]);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const [isDemoMode, setIsDemoMode] = useState<boolean>(true);
  
  // Stats & Ledger States
  const [flaggedEntries, setFlaggedEntries] = useState<any[]>([]);
  const [loadingFlagged, setLoadingFlagged] = useState<boolean>(false);
  
  // Gamification/Points
  const [points, setPoints] = useState<number>(() => {
    return parseInt(localStorage.getItem('mediverify_points') || '350', 10);
  });
  
  // Chat States
  const [chatInput, setChatInput] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<Array<{sender: 'user' | 'bot', text: string, time: string}>>([
    { sender: 'bot', text: 'Hello! I am the MediVerify AI Assistant. How can I help you authenticate documents today?', time: '10:30 AM' }
  ]);
  
  // FAQ accordion state
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  // Settings states
  const [notifEnabled, setNotifEnabled] = useState<boolean>(true);
  const [autoSync, setAutoSync] = useState<boolean>(true);

  // Ref handles
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Auto messages loader
  useEffect(() => {
    if (!loading) return;
    const msgs = [
      'Connecting to secure medical gateway...',
      'Initializing optical character recognition...',
      'Extracting clinical text features...',
      'Analyzing batch code signatures...',
      'Matching against distributed trusted ledger...',
      'Generating final verification report...'
    ];
    let idx = 0;
    setLoadingMsg(msgs[0]);
    const interval = setInterval(() => {
      idx = (idx + 1) % msgs.length;
      setLoadingMsg(msgs[idx]);
    }, 1200);
    return () => clearInterval(interval);
  }, [loading]);

  const fetchFlaggedEntries = async () => {
    setLoadingFlagged(true);
    try {
      const data = await apiFetchFlaggedEntries();
      setFlaggedEntries(data);
    } catch (e) {
      console.error("Failed to fetch flagged logs", e);
    } finally {
      setLoadingFlagged(false);
    }
  };

  useEffect(() => {
    if (isLoggedIn) {
      fetchFlaggedEntries();
    }
  }, [isLoggedIn, currentScreen]);

  // Load history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('mediverify_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse history", e);
      }
    }
  }, []);

  const saveToHistory = (newResult: VerificationResult) => {
    const updated = [newResult, ...history.slice(0, 9)]; // Limit to last 10
    setHistory(updated);
    localStorage.setItem('mediverify_history', JSON.stringify(updated));
    
    // Add points for scanning
    const bonus = newResult.status === 'Verified Genuine' ? 50 : 15;
    const newPoints = points + bonus;
    setPoints(newPoints);
    localStorage.setItem('mediverify_points', newPoints.toString());
  };

  const handleFileChange = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid document image file (PNG, JPG, JPEG, WEBP).');
      return;
    }
    setError(null);
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileChange(e.target.files[0]);
    }
  };

  const handleVerify = async () => {
    if (!selectedFile) return;

    setLoading(true);
    setError(null);
    setResult(null);

    if (isDemoMode) {
      setTimeout(() => {
        const mockResult: VerificationResult = {
          filename: selectedFile.name,
          format: "JPEG",
          dimensions: "1024x768",
          size_bytes: selectedFile.size,
          status: "Verified Genuine",
          confidence_score: 98,
          extracted_fields: {
            patient_name: "John Doe",
            provider: "Dr. Smith",
            issue_date: new Date().toISOString().split('T')[0],
            document_type: "Prescription",
            details: "Rx: PARACIP - 650 (Batch: PRC1029)"
          },
          analysis_flags: [
            "Batch number PRC1029 verified against trusted ledger.",
            "Medicine name matches trusted product: PARACIP - 650 (BioPharma Corp)."
          ],
          timestamp: new Date().toISOString(),
          raw_text: "Medicine Name: PARACIP - 650\nBatch Number: PRC1029\nTake 1 tablet daily.",
          detected_medicine_name: "PARACIP - 650",
          detected_batch_number: "PRC1029",
          matched_entry: {
            medicine_name: "PARACIP - 650",
            batch_number: "PRC1029",
            manufacturer: "BioPharma Corp",
            expiry_date: "2027-12-01"
          }
        };
        setResult(mockResult);
        saveToHistory(mockResult);
        setLoading(false);
      }, 2500);
      return;
    }

    try {
      const data: VerificationResult = await verifyDocument(selectedFile);
      setResult(data);
      saveToHistory(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Unable to connect to MediVerify server. Verify backend is running.');
    } finally {
      setLoading(false);
    }
  };

  const resetScanner = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  // Auth functions - backed by Amazon Cognito when configured (see lib/auth.ts),
  // falling back to the original localStorage mock otherwise so the UI keeps
  // working before AWS resources are deployed.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail) return;
    setAuthError(null);

    if (!isCognitoConfigured()) {
      localStorage.setItem('mediverify_logged_in', 'true');
      localStorage.setItem('mediverify_user_name', currentUser.name);
      localStorage.setItem('mediverify_user_email', loginEmail);
      setIsLoggedIn(true);
      setCurrentScreen('home');
      return;
    }

    setAuthLoading(true);
    try {
      const user = await cognitoSignIn(loginEmail, loginPassword);
      setCurrentUser({ name: user.name, email: user.email });
      localStorage.setItem('mediverify_logged_in', 'true');
      localStorage.setItem('mediverify_user_name', user.name);
      localStorage.setItem('mediverify_user_email', user.email);
      setIsLoggedIn(true);
      setCurrentScreen('home');
    } catch (err: any) {
      setAuthError(err.message || 'Sign in failed. Please check your credentials.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUpEmail || !signUpName) return;
    setAuthError(null);

    if (!isCognitoConfigured()) {
      setCurrentUser({ name: signUpName, email: signUpEmail });
      localStorage.setItem('mediverify_logged_in', 'true');
      localStorage.setItem('mediverify_user_name', signUpName);
      localStorage.setItem('mediverify_user_email', signUpEmail);
      setIsLoggedIn(true);
      setPoints(100); // Startup bonus points!
      localStorage.setItem('mediverify_points', '100');
      setCurrentScreen('home');
      return;
    }

    setAuthLoading(true);
    try {
      await cognitoSignUp(signUpName, signUpEmail, signUpPass);
      setCurrentUser({ name: signUpName, email: signUpEmail });
      setCurrentScreen('confirm');
    } catch (err: any) {
      setAuthError(err.message || 'Sign up failed. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleConfirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmCode) return;
    setAuthError(null);
    setAuthLoading(true);
    try {
      await cognitoConfirmSignUp(signUpEmail, confirmCode);
      const user = await cognitoSignIn(signUpEmail, signUpPass);
      localStorage.setItem('mediverify_logged_in', 'true');
      localStorage.setItem('mediverify_user_name', user.name);
      localStorage.setItem('mediverify_user_email', user.email);
      setIsLoggedIn(true);
      setPoints(100); // Startup bonus points!
      localStorage.setItem('mediverify_points', '100');
      setCurrentScreen('home');
    } catch (err: any) {
      setAuthError(err.message || 'Invalid or expired code. Please try again.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResendCode = async () => {
    setAuthError(null);
    try {
      await cognitoResendConfirmationCode(signUpEmail);
    } catch (err: any) {
      setAuthError(err.message || 'Could not resend code.');
    }
  };

  const handleLogout = () => {
    if (isCognitoConfigured()) {
      cognitoSignOut();
    }
    localStorage.removeItem('mediverify_logged_in');
    setIsLoggedIn(false);
    setDrawerOpen(false);
    setCurrentScreen('login');
  };

  // Support chat helper - backed by Amazon Bedrock via the /chat Lambda.
  // Falls back to a canned response if the assistant is unreachable so the
  // panel never appears broken.
  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setChatMessages(prev => [...prev, { sender: 'user', text: userMsg, time: timeString }]);
    setChatInput('');

    try {
      const reply = await sendChatMessage(userMsg);
      setChatMessages(prev => [...prev, { sender: 'bot', text: reply, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
    } catch (e) {
      console.error('Chat assistant error', e);
      setChatMessages(prev => [...prev, {
        sender: 'bot',
        text: "I have logged your request. Our clinical security experts will review it shortly. You can also upload medicine documents in the Scanner tab for instant ledger authentication.",
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }]);
    }
  };

  // Level computation
  const currentLevel = Math.floor(points / 500) + 1;
  const pointsToNextLevel = 500 - (points % 500);
  const levelProgressPercent = ((points % 500) / 500) * 100;

  // Render sub-screens
  const renderScreen = () => {
    switch (currentScreen) {
      case 'home':
        return (
          <div className="space-y-6 animate-fade-in pb-12">
            {/* Top Level Progress Card */}
            <div className="bg-white rounded-3xl p-6 shadow-soft border border-emerald-500/5 relative overflow-hidden">
              <div className="absolute right-0 top-0 w-24 h-24 bg-brand-secondary rounded-full -mr-8 -mt-8 opacity-40"></div>
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-brand-secondary flex items-center justify-center border border-emerald-200">
                  <Award className="h-8 w-8 text-brand-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-brand-primary uppercase tracking-wider">Security Tier</span>
                    <span className="text-xs text-slate-500 font-medium">Level {currentLevel}</span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mt-0.5">Clinical Guardian</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{pointsToNextLevel} points to level up</p>
                </div>
              </div>
              <div className="mt-4">
                <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-primary rounded-full transition-all duration-700" style={{ width: `${levelProgressPercent}%` }}></div>
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-400 mt-1.5">
                  <span>{points % 500} pts</span>
                  <span>500 pts</span>
                </div>
              </div>
            </div>

            {/* Quick Actions / Main Button */}
            <div className="flex flex-col">
              <button 
                onClick={() => setCurrentScreen('scanner')}
                className="w-full bg-brand-primary hover:bg-brand-hover text-white rounded-3xl p-5 shadow-button transition-all duration-200 text-left flex flex-col justify-between h-36 btn-press-active"
              >
                <div className="h-10 w-10 rounded-2xl bg-white/20 flex items-center justify-center">
                  <Camera className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h4 className="font-bold text-base">New Scan</h4>
                  <p className="text-[11px] text-emerald-100 opacity-90 mt-0.5">Verify prescription/document</p>
                </div>
              </button>
            </div>

            {/* Stats Summary Card */}
            <div className="bg-white rounded-3xl p-5 shadow-soft border border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-bold text-slate-800 text-sm">Security Ledger Summary</h4>
                <button onClick={() => setCurrentScreen('statistics')} className="text-xs text-brand-primary font-bold flex items-center gap-1">
                  View All <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-brand-grayBg rounded-2xl border border-slate-50">
                  <span className="text-[10px] text-slate-400 font-bold block uppercase">Total Scanned</span>
                  <span className="text-2xl font-bold text-slate-800 mt-1 block">{history.length}</span>
                </div>
                <div className="p-3 bg-brand-grayBg rounded-2xl border border-slate-50">
                  <span className="text-[10px] text-rose-500 font-bold block uppercase">Flagged</span>
                  <span className="text-2xl font-bold text-rose-500 mt-1 block">{flaggedEntries.length}</span>
                </div>
                <div className="p-3 bg-brand-grayBg rounded-2xl border border-slate-50">
                  <span className="text-[10px] text-brand-primary font-bold block uppercase">Success Rate</span>
                  <span className="text-2xl font-bold text-brand-primary mt-1 block">
                    {history.length > 0 
                      ? `${Math.round(((history.length - flaggedEntries.length) / history.length) * 100)}%` 
                      : '100%'}
                  </span>
                </div>
              </div>
            </div>

            {/* Latest Announcement */}
            <div className="bg-emerald-50/50 rounded-3xl p-5 border border-emerald-100 flex gap-4">
              <div className="h-10 w-10 rounded-2xl bg-brand-secondary flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5 text-brand-primary animate-pulse" />
              </div>
              <div>
                <h5 className="font-bold text-xs text-slate-800 uppercase tracking-wider">AI Ledger Upgraded</h5>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Version 1.3 verification matrix is active. Automated cross-referencing is now 40% faster on clinical batch serials.
                </p>
              </div>
            </div>
          </div>
        );
      case 'scanner':
        return (
          <div className="space-y-6 animate-fade-in pb-12">
            <div className="bg-white rounded-3xl p-6 shadow-soft border border-slate-100">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-slate-800 text-lg">Document Scanner</h3>
                  <p className="text-xs text-slate-400">Position prescription text or label inside the box</p>
                </div>
                <button onClick={resetScanner} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>

              {/* DEMO MODE TOGGLE */}
              <div className="mb-4 flex items-center justify-between bg-emerald-50 rounded-2xl p-3 border border-emerald-100">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-brand-primary" /> Demo Mode</h4>
                </div>
                <button 
                  onClick={() => setIsDemoMode(!isDemoMode)}
                  className={`w-12 h-6 rounded-full p-1 transition-colors ${isDemoMode ? 'bg-brand-primary' : 'bg-slate-300'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full transition-transform ${isDemoMode ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
              </div>

              {/* Upload Zone */}
              {!previewUrl ? (
                <div 
                  className={`border-2 border-dashed rounded-3xl p-8 text-center transition-all duration-350 cursor-pointer ${
                    dragActive 
                      ? 'border-brand-primary bg-brand-secondary/40' 
                      : 'border-slate-200 bg-brand-grayBg hover:border-brand-primary/60'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      handleFileChange(e.dataTransfer.files[0]);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="h-14 w-14 mx-auto mb-4 rounded-2xl bg-brand-secondary flex items-center justify-center text-brand-primary shadow-soft">
                    <Upload className="h-5 w-5" />
                  </div>
                  <h4 className="font-bold text-slate-800 mb-1 text-sm">
                    Drag & Drop prescription photo
                  </h4>
                  <p className="text-slate-400 text-xs mb-5">PNG, JPG or WEBP up to 10MB</p>
                  
                  <div className="flex items-center justify-center gap-3">
                    <button
                      type="button"
                      className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 rounded-2xl text-xs font-bold flex items-center gap-2 border border-slate-200 transition-colors shadow-sm btn-press-active"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      <FileText className="h-4 w-4 text-slate-400" />
                      Browse Files
                    </button>
                    <button
                      type="button"
                      className="px-4 py-2.5 bg-brand-primary hover:bg-brand-hover text-white rounded-2xl text-xs font-bold flex items-center gap-2 transition-all shadow-md btn-press-active"
                      onClick={(e) => {
                        e.stopPropagation();
                        cameraInputRef.current?.click();
                      }}
                    >
                      <Camera className="h-4 w-4" />
                      Use Camera
                    </button>
                  </div>
                </div>
              ) : (
                /* Preview Container */
                <div className="space-y-4">
                  <div className="relative rounded-3xl overflow-hidden bg-slate-900 h-64 flex items-center justify-center">
                    {loading && <div className="animate-scan-line z-10"></div>}
                    <img 
                      src={previewUrl} 
                      alt="Document scan preview" 
                      className={`object-contain h-full w-full ${loading ? 'opacity-80' : ''}`}
                    />
                    <button
                      onClick={resetScanner}
                      className="absolute top-4 right-4 p-2 bg-white/90 backdrop-blur hover:bg-white text-slate-800 rounded-xl transition-colors shadow-soft"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500 bg-brand-grayBg p-3.5 rounded-2xl border border-slate-100">
                    <div className="flex items-center gap-2 truncate pr-4">
                      <ImageIcon className="h-4 w-4 text-brand-primary" />
                      <span className="truncate font-medium">{selectedFile?.name}</span>
                    </div>
                    <span className="font-semibold shrink-0">{(selectedFile!.size / 1024).toFixed(1)} KB</span>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={resetScanner}
                      className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl text-xs font-bold transition-all btn-press-active"
                      disabled={loading}
                    >
                      Reset
                    </button>
                    <button
                      onClick={handleVerify}
                      className="flex-[2] py-3 bg-brand-primary hover:bg-brand-hover text-white rounded-2xl text-xs font-bold transition-all shadow-button flex items-center justify-center gap-2 btn-press-active"
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" />
                          {loadingMsg}
                        </>
                      ) : (
                        <>
                          <Activity className="h-4 w-4" />
                          Verify Integrity
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Hidden file triggers */}
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={onFileSelect}
                accept="image/*"
                className="hidden" 
              />
              <input 
                type="file" 
                ref={cameraInputRef} 
                onChange={onFileSelect}
                accept="image/*"
                capture="environment"
                className="hidden" 
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-rose-50 border border-rose-100 rounded-3xl p-4 flex items-start gap-3 text-rose-800 text-xs">
                <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0" />
                <div>
                  <h4 className="font-bold text-rose-900">Analysis Stopped</h4>
                  <p className="mt-0.5 opacity-90">{error}</p>
                </div>
              </div>
            )}

            {/* Scanner Verification Result View */}
            {result && !loading && (
              <div className="bg-white rounded-3xl p-6 shadow-soft border border-slate-100 space-y-6 animate-fade-in">
                <div className="text-center p-4 bg-brand-grayBg rounded-3xl border border-slate-50 relative overflow-hidden">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">Integrity Score</span>
                  <h2 className={`text-5xl font-extrabold tracking-tight font-sans mt-1 ${
                    result.confidence_score > 80 
                      ? 'text-brand-primary' 
                      : result.confidence_score >= 40 
                      ? 'text-amber-500' 
                      : 'text-rose-500'
                  }`}>
                    {result.confidence_score}%
                  </h2>
                  <div className="mt-3 flex justify-center">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold border ${
                      result.confidence_score > 80 
                        ? 'bg-emerald-50 text-brand-primary border-emerald-200' 
                        : result.confidence_score >= 40 
                        ? 'bg-amber-50 text-amber-600 border-amber-200' 
                        : 'bg-rose-50 text-rose-600 border-rose-200'
                    }`}>
                      {result.status}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Parsed Ledger Fields</h4>
                  <div className="bg-brand-light rounded-3xl p-5 border border-emerald-500/5 space-y-3.5 text-xs">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                      <span className="text-slate-400">Document Class</span>
                      <span className="text-slate-700 font-bold">{result.extracted_fields.document_type}</span>
                    </div>
                    {result.detected_medicine_name && (
                      <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <span className="text-slate-400 font-bold text-brand-primary">Medicine Identified</span>
                        <span className="text-slate-800 font-extrabold">{result.detected_medicine_name}</span>
                      </div>
                    )}
                    {result.detected_batch_number && (
                      <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <span className="text-slate-400 font-bold text-brand-primary">Ledger Batch</span>
                        <span className="font-mono bg-white border border-slate-200 px-2 py-0.5 rounded-lg text-slate-800 font-extrabold text-[11px]">
                          {result.detected_batch_number}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                      <span className="text-slate-400">Target Patient</span>
                      <span className="text-slate-700 font-bold">{result.extracted_fields.patient_name}</span>
                    </div>
                    <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                      <span className="text-slate-400">Medical Provider</span>
                      <span className="text-slate-700 font-bold">{result.extracted_fields.provider}</span>
                    </div>
                    {result.matched_entry && (
                      <>
                        <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                          <span className="text-slate-400">Manufacturer</span>
                          <span className="text-brand-primary font-bold">{result.matched_entry.manufacturer}</span>
                        </div>
                        <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                          <span className="text-slate-400">Expiry Date</span>
                          <span className="text-brand-primary font-bold">{result.matched_entry.expiry_date}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between items-start">
                      <span className="text-slate-400">Diagnostic Details</span>
                      <span className="text-slate-700 font-medium text-right italic max-w-[180px] leading-relaxed">{result.extracted_fields.details}</span>
                    </div>
                  </div>
                </div>

                {result.raw_text && (
                  <div className="space-y-2">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">OCR Raw Text Segment</h4>
                    <div className="bg-brand-grayBg rounded-2xl p-4 max-h-32 overflow-y-auto text-[10px] font-mono text-slate-500 border border-slate-100 whitespace-pre-wrap">
                      {result.raw_text}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">AI Audit Alerts</h4>
                  <div className="space-y-2">
                    {result.analysis_flags.map((flag, idx) => (
                      <div key={idx} className="flex gap-2.5 items-start text-xs text-slate-600 bg-brand-grayBg p-3 rounded-2xl border border-slate-100">
                        <ChevronRight className="h-4.5 w-4.5 text-brand-primary shrink-0 mt-0.5" />
                        <span className="leading-normal">{flag}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );

      case 'statistics':
        return (
          <div className="space-y-6 animate-fade-in pb-12">
            {/* Stats Ring Card */}
            <div className="bg-white rounded-3xl p-6 shadow-soft border border-slate-100 flex flex-col items-center">
              <h3 className="font-bold text-slate-800 text-base mb-1">Authenticity Ratios</h3>
              <p className="text-xs text-slate-400 mb-6">Aggregate analysis accuracy levels</p>

              {/* Progress Ring Simulation */}
              <div className="relative h-44 w-44 flex items-center justify-center">
                <svg className="absolute transform -rotate-90 w-full h-full" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" stroke="#F3F4F6" strokeWidth="8" fill="transparent" />
                  <circle cx="50" cy="50" r="40" stroke="#18A558" strokeWidth="8" fill="transparent" 
                          strokeDasharray="251.2" 
                          strokeDashoffset={251.2 - (251.2 * (history.length > 0 ? ((history.length - flaggedEntries.length) / history.length) : 1))} 
                          strokeLinecap="round" />
                </svg>
                <div className="text-center z-10">
                  <h4 className="text-4xl font-extrabold text-slate-800">
                    {history.length > 0 
                      ? Math.round(((history.length - flaggedEntries.length) / history.length) * 100) 
                      : 100}%
                  </h4>
                  <span className="text-[10px] text-slate-400 font-bold block uppercase mt-0.5">Genuine Matches</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-8 w-full mt-6 pt-4 border-t border-slate-100">
                <div className="text-center">
                  <span className="h-2.5 w-2.5 rounded-full bg-brand-primary inline-block mr-1.5"></span>
                  <span className="text-xs text-slate-400">Genuine</span>
                  <h5 className="text-lg font-bold text-slate-800 mt-0.5">{history.length - flaggedEntries.length}</h5>
                </div>
                <div className="text-center">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500 inline-block mr-1.5"></span>
                  <span className="text-xs text-slate-400">Flagged</span>
                  <h5 className="text-lg font-bold text-slate-800 mt-0.5">{flaggedEntries.length}</h5>
                </div>
              </div>
            </div>

            {/* Document distribution */}
            <div className="bg-white rounded-3xl p-5 shadow-soft border border-slate-100">
              <h4 className="font-bold text-slate-800 text-sm mb-4">Verification Ledger Audit Log</h4>
              <div className="space-y-4">
                {[
                  { name: 'Genuine Prescriptions', count: history.length - flaggedEntries.length, percent: history.length > 0 ? Math.round(((history.length - flaggedEntries.length) / history.length) * 100) : 100, color: 'bg-brand-primary' },
                  { name: 'Flagged Mismatches', count: flaggedEntries.length, percent: history.length > 0 ? Math.round((flaggedEntries.length / history.length) * 100) : 0, color: 'bg-rose-500' }
                ].map((item, idx) => (
                  <div key={idx} className="space-y-1.5">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-slate-600">{item.name} ({item.count})</span>
                      <span className="text-slate-800">{item.percent}%</span>
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.percent}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      case 'history':
        return (
          <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex justify-between items-center pl-1">
              <div>
                <h3 className="font-bold text-slate-800 text-base">Verification Audits</h3>
                <p className="text-xs text-slate-400">Previous scans history cache</p>
              </div>
              <button 
                onClick={() => {
                  localStorage.removeItem('mediverify_history');
                  setHistory([]);
                }}
                className="text-xs text-rose-500 font-bold hover:underline"
              >
                Clear Cache
              </button>
            </div>

            {history.length === 0 ? (
              <div className="bg-white rounded-3xl p-8 text-center border border-slate-100 shadow-soft">
                <FileText className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                <h4 className="font-bold text-slate-700 text-sm">No Audit History Found</h4>
                <p className="text-xs text-slate-400 max-w-[200px] mx-auto mt-1">Scan verification receipts and documents to log them here</p>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((h, i) => (
                  <div key={i} className="bg-white rounded-3xl p-4 shadow-soft border border-slate-100 flex items-center justify-between card-hover-effect">
                    <div className="flex items-center gap-3">
                      <div className={`h-10 w-10 rounded-2xl flex items-center justify-center ${h.status === 'Verified Genuine' ? 'bg-emerald-50 text-brand-primary' : 'bg-rose-50 text-rose-500'}`}>
                        {h.status === 'Verified Genuine' ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                      </div>
                      <div>
                        <h5 className="font-bold text-slate-800 text-xs truncate max-w-[140px]">{h.filename}</h5>
                        <p className="text-[10px] text-slate-400 mt-0.5">{h.timestamp || 'July 9, 2026'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${h.status === 'Verified Genuine' ? 'bg-emerald-50 text-brand-primary border-emerald-100' : 'bg-rose-50 text-rose-500 border-rose-100'}`}>
                        {h.status.split(':')[0]}
                      </span>
                      <p className="text-[10px] text-slate-500 font-bold mt-1">{h.confidence_score}%</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      case 'notifications':
        return (
          <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex justify-between items-center pl-1">
              <div>
                <h3 className="font-bold text-slate-800 text-base">Incident Alerts</h3>
                <p className="text-xs text-slate-400">Security notifications & system alerts</p>
              </div>
              <button 
                onClick={fetchFlaggedEntries} 
                className="text-xs text-brand-primary font-bold hover:underline flex items-center gap-1"
                disabled={loadingFlagged}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingFlagged ? 'animate-spin' : ''}`} />
                Refresh Logs
              </button>
            </div>

            {flaggedEntries.length === 0 ? (
              <div className="bg-white rounded-3xl p-8 text-center border border-slate-100 shadow-soft">
                <Bell className="h-10 w-10 text-slate-350 mx-auto mb-2" />
                <h4 className="font-bold text-slate-700 text-sm">All Clear</h4>
                <p className="text-xs text-slate-400 max-w-[200px] mx-auto mt-1">No security incident alerts or suspicious logs logged in this runtime.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {flaggedEntries.map((entry, idx) => (
                  <div key={idx} className="bg-white rounded-3xl p-4 shadow-soft border border-rose-100 flex gap-3.5 card-hover-effect">
                    <div className="h-10 w-10 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-500 shrink-0">
                      <ShieldAlert className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded-md uppercase">Mismatched Serial</span>
                        <span className="text-[9px] text-slate-400">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <h5 className="font-bold text-slate-800 text-xs mt-1.5">Suspicious attempt logged</h5>
                      <p className="text-xs text-slate-500 mt-0.5">Medicine: <strong className="text-slate-700">{entry.detected_medicine_name}</strong> | Batch: <strong className="text-slate-700">{entry.detected_batch_number}</strong></p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      case 'profile':
        return (
          <div className="space-y-6 animate-fade-in pb-12">
            {/* Profile Info Header */}
            <div className="bg-white rounded-3xl p-6 shadow-soft border border-slate-100 text-center">
              <div className="relative inline-block">
                <div className="h-20 w-20 rounded-full bg-brand-secondary border-2 border-brand-primary flex items-center justify-center mx-auto text-brand-primary text-2xl font-extrabold shadow-soft">
                  {currentUser.name.charAt(0) + currentUser.name.split(' ').slice(-1)[0].charAt(0)}
                </div>
              </div>
              <h3 className="font-extrabold text-slate-800 text-lg mt-3">{currentUser.name}</h3>
              <p className="text-xs text-slate-400 mt-0.5">{currentUser.email}</p>
              
              <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-slate-100 text-center">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block uppercase">Tier Level</span>
                  <span className="text-lg font-extrabold text-slate-800 mt-0.5 block">Guardian Lvl {currentLevel}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block uppercase">Points Earned</span>
                  <span className="text-lg font-extrabold text-brand-primary mt-0.5 block">{points} pts</span>
                </div>
              </div>
            </div>

            {/* Profile Action Cards */}
            <div className="space-y-3">

              <button 
                onClick={() => setCurrentScreen('settings')}
                className="w-full bg-white rounded-3xl p-4 shadow-soft border border-slate-100 flex items-center justify-between text-left card-hover-effect btn-press-active"
              >
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-brand-secondary flex items-center justify-center text-brand-primary">
                    <SettingsIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <h5 className="font-bold text-slate-800 text-xs">Security Settings</h5>
                    <p className="text-[10px] text-slate-400">Configure ledger credentials & API sync</p>
                  </div>
                </div>
                <ChevronRight className="h-4.5 w-4.5 text-slate-350" />
              </button>
            </div>
          </div>
        );
      case 'settings':
        return (
          <div className="space-y-6 animate-fade-in pb-12">
            <div className="bg-white rounded-3xl p-6 shadow-soft border border-slate-100 space-y-5">
              <h3 className="font-bold text-slate-800 text-base">App Preferences</h3>

              {/* Toggles */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                  <div>
                    <h5 className="font-bold text-slate-800 text-xs">Mismatched Incident Alerts</h5>
                    <p className="text-[10px] text-slate-400 mt-0.5">Alert on counterfeit batch scans</p>
                  </div>
                  <button 
                    onClick={() => setNotifEnabled(!notifEnabled)}
                    className={`w-10 h-6 rounded-full transition-colors relative ${notifEnabled ? 'bg-brand-primary' : 'bg-slate-200'}`}
                  >
                    <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${notifEnabled ? 'translate-x-4' : 'translate-x-0'}`}></span>
                  </button>
                </div>

                <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                  <div>
                    <h5 className="font-bold text-slate-800 text-xs">Auto Ledger Sync</h5>
                    <p className="text-[10px] text-slate-400 mt-0.5">Sync database entries in background</p>
                  </div>
                  <button 
                    onClick={() => setAutoSync(!autoSync)}
                    className={`w-10 h-6 rounded-full transition-colors relative ${autoSync ? 'bg-brand-primary' : 'bg-slate-200'}`}
                  >
                    <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${autoSync ? 'translate-x-4' : 'translate-x-0'}`}></span>
                  </button>
                </div>
              </div>

              {/* Version Detail */}
              <div className="pt-2 flex justify-between items-center text-xs text-slate-400">
                <span>Client Integrity Engine</span>
                <span className="font-mono font-bold text-brand-primary bg-brand-secondary px-2 py-0.5 rounded-lg text-[10px]">v1.3.0</span>
              </div>
            </div>

            <button 
              onClick={handleLogout}
              className="w-full py-3.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-3xl text-xs font-bold transition-all flex items-center justify-center gap-2 btn-press-active border border-rose-200/50"
            >
              <LogOut className="h-4 w-4" />
              Sign Out Securely
            </button>
          </div>
        );
      case 'faq':
        return (
          <div className="space-y-6 animate-fade-in pb-12">
            <h3 className="font-bold text-slate-800 text-base pl-1">Frequently Asked Questions</h3>
            <div className="space-y-3">
              {[
                { q: 'How does digital integrity verification work?', a: 'MediVerify parses medicine tags and extracts manufacturer serial parameters using AI OCR, cross-referencing values with verified distributed catalogs.' },
                { q: 'What does "Not Found / Suspicious" represent?', a: 'This warning triggers when a batch serialization code is identified, but its corresponding medicine compound fails authenticity checks or has not been logged.' },
                { q: 'How can I redeem acquired credits?', a: 'You earn points on scanning validations. Navigate to Wallet or Rewards and click redeem for developer API discounts.' },
                { q: 'What format of images are supported?', a: 'Standard file uploads of PNG, JPG, JPEG, and WebP images are supported. Ensure the clinical labels are clean and visible.' }
              ].map((faq, index) => {
                const isOpen = openFaqIndex === index;
                return (
                  <div key={index} className="bg-white rounded-3xl shadow-soft border border-slate-100 overflow-hidden">
                    <button 
                      onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                      className="w-full p-5 text-left flex justify-between items-center hover:bg-slate-50 transition-colors"
                    >
                      <span className="font-bold text-slate-800 text-xs leading-normal pr-4">{faq.q}</span>
                      <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="p-5 pt-0 border-t border-slate-50 text-xs text-slate-500 leading-relaxed bg-brand-grayBg">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      case 'support':
        return (
          <div className="flex flex-col h-[480px] bg-white rounded-3xl shadow-soft border border-slate-100 overflow-hidden animate-fade-in">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-brand-secondary flex items-center justify-center text-brand-primary">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-800 text-sm">Security Response Desk</h4>
                <p className="text-[10px] text-slate-400">Live AI clinical helper available</p>
              </div>
            </div>

            {/* Messages Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-brand-grayBg">
              {chatMessages.map((msg, index) => {
                const isBot = msg.sender === 'bot';
                return (
                  <div key={index} className={`flex ${isBot ? 'justify-start' : 'justify-end'} animate-fade-in`}>
                    <div className={`max-w-[80%] rounded-2xl p-3.5 text-xs shadow-soft ${
                      isBot 
                        ? 'bg-white text-slate-700 rounded-tl-none border border-slate-100' 
                        : 'bg-brand-primary text-white rounded-tr-none'
                    }`}>
                      <p className="leading-relaxed">{msg.text}</p>
                      <span className={`text-[9px] mt-1.5 block text-right ${isBot ? 'text-slate-400' : 'text-emerald-100'}`}>
                        {msg.time}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Input Bar */}
            <div className="p-3 bg-white border-t border-slate-100 flex gap-2">
              <input 
                type="text" 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about batch code validation..."
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs focus:outline-none focus:border-brand-primary/45 transition-colors"
              />
              <button 
                onClick={handleSendMessage}
                className="h-10 w-10 bg-brand-primary hover:bg-brand-hover text-white rounded-2xl flex items-center justify-center shadow-md btn-press-active shrink-0 transition-colors"
              >
                <Send className="h-4.5 w-4.5" />
              </button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  // Render Login and Sign Up screen wrappers if not authenticated
  if (!isLoggedIn) {
    if (currentScreen === 'signup') {
      return (
        <div className="min-h-screen bg-brand-grayBg flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-premium border border-emerald-500/5 space-y-6 animate-slide-up">
            {/* Header logo */}
            <div className="text-center">
              <div className="h-12 w-12 rounded-2xl bg-brand-secondary flex items-center justify-center mx-auto text-brand-primary shadow-soft mb-3">
                <Activity className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-extrabold text-slate-800">Getting Started</h2>
              <p className="text-xs text-slate-400 mt-1">Create a secure medical auditor account</p>
            </div>

            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Full Name</label>
                <input 
                  type="text" 
                  value={signUpName}
                  onChange={(e) => setSignUpName(e.target.value)}
                  placeholder="Dr. Alex Mercer"
                  required
                  className="w-full px-4 py-3 bg-brand-grayBg border border-slate-100 rounded-2xl text-xs text-slate-900 font-medium focus:outline-none focus:border-brand-primary/45 focus:bg-white transition-all shadow-inner"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Email Address</label>
                <input 
                  type="email" 
                  value={signUpEmail}
                  onChange={(e) => setSignUpEmail(e.target.value)}
                  placeholder="alex.mercer@apexhealth.org"
                  required
                  className="w-full px-4 py-3 bg-brand-grayBg border border-slate-100 rounded-2xl text-xs text-slate-900 font-medium focus:outline-none focus:border-brand-primary/45 focus:bg-white transition-all shadow-inner"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Security Password</label>
                <input 
                  type="password" 
                  value={signUpPass}
                  onChange={(e) => setSignUpPass(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="w-full px-4 py-3 bg-brand-grayBg border border-slate-100 rounded-2xl text-xs text-slate-900 font-medium focus:outline-none focus:border-brand-primary/45 focus:bg-white transition-all shadow-inner"
                />
              </div>

              {authError && (
                <p className="text-[11px] text-rose-500 font-medium bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{authError}</p>
              )}

              <button 
                type="submit" 
                disabled={authLoading}
                className="w-full py-3.5 bg-brand-primary hover:bg-brand-hover text-white rounded-2xl text-xs font-bold transition-all shadow-button btn-press-active mt-2 disabled:opacity-60"
              >
                {authLoading ? 'Creating Account...' : 'Sign Up Securely'}
              </button>
            </form>

            <div className="text-center pt-2">
              <button 
                onClick={() => { setAuthError(null); setCurrentScreen('login'); }}
                className="text-xs text-brand-primary font-bold hover:underline"
              >
                Already have an account? Sign In
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (currentScreen === 'confirm') {
      return (
        <div className="min-h-screen bg-brand-grayBg flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-premium border border-emerald-500/5 space-y-6 animate-slide-up">
            <div className="text-center">
              <div className="h-12 w-12 rounded-2xl bg-brand-secondary flex items-center justify-center mx-auto text-brand-primary shadow-soft mb-3">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <h2 className="text-2xl font-extrabold text-slate-800">Verify Your Email</h2>
              <p className="text-xs text-slate-400 mt-1">Enter the code sent to {signUpEmail}</p>
            </div>

            <form onSubmit={handleConfirmCode} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Confirmation Code</label>
                <input 
                  type="text" 
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  placeholder="123456"
                  required
                  className="w-full px-4 py-3 bg-brand-grayBg border border-slate-100 rounded-2xl text-xs text-slate-900 font-medium focus:outline-none focus:border-brand-primary/45 focus:bg-white transition-all shadow-inner tracking-widest text-center font-mono"
                />
              </div>

              {authError && (
                <p className="text-[11px] text-rose-500 font-medium bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{authError}</p>
              )}

              <button 
                type="submit" 
                disabled={authLoading}
                className="w-full py-3.5 bg-brand-primary hover:bg-brand-hover text-white rounded-2xl text-xs font-bold transition-all shadow-button btn-press-active mt-2 disabled:opacity-60"
              >
                {authLoading ? 'Verifying...' : 'Confirm & Continue'}
              </button>
            </form>

            <div className="text-center pt-2">
              <button 
                onClick={handleResendCode}
                className="text-xs text-brand-primary font-bold hover:underline"
              >
                Resend Code
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-brand-grayBg flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-premium border border-emerald-500/5 space-y-6 animate-slide-up">
          {/* Header logo */}
          <div className="text-center">
            <div className="h-12 w-12 rounded-2xl bg-brand-secondary flex items-center justify-center mx-auto text-brand-primary shadow-soft mb-3">
              <Activity className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-extrabold text-slate-800">Welcome Back!</h2>
            <p className="text-xs text-slate-400 mt-1">Sign in to query verification ledger</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Email Address</label>
              <input 
                type="email" 
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="alex.mercer@apexhealth.org"
                required
                className="w-full px-4 py-3 bg-brand-grayBg border border-slate-100 rounded-2xl text-xs focus:outline-none focus:border-brand-primary/45 focus:bg-white transition-all shadow-inner"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pl-1">Password</label>
              <input 
                type="password" 
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                className="w-full px-4 py-3 bg-brand-grayBg border border-slate-100 rounded-2xl text-xs focus:outline-none focus:border-brand-primary/45 focus:bg-white transition-all shadow-inner"
              />
            </div>

            {authError && (
              <p className="text-[11px] text-rose-500 font-medium bg-rose-50 border border-rose-100 rounded-xl px-3 py-2">{authError}</p>
            )}

            <button 
              type="submit" 
              disabled={authLoading}
              className="w-full py-3.5 bg-brand-primary hover:bg-brand-hover text-white rounded-2xl text-xs font-bold transition-all shadow-button btn-press-active mt-2 disabled:opacity-60"
            >
              {authLoading ? 'Signing In...' : 'Sign In Securely'}
            </button>
          </form>

          <div className="text-center pt-2">
            <button 
              onClick={() => { setAuthError(null); setCurrentScreen('signup'); }}
              className="text-xs text-brand-primary font-bold hover:underline"
            >
              First time auditing? Create Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-grayBg text-slate-700 flex flex-col font-sans relative">
      {/* Drawer Overlay */}
      {drawerOpen && (
        <div 
          className="absolute inset-0 bg-slate-900/25 backdrop-blur-xs z-40 transition-opacity animate-fade-in"
          onClick={() => setDrawerOpen(false)}
        ></div>
      )}

      {/* Navigation Drawer */}
      <aside 
        className={`absolute top-0 bottom-0 left-0 w-64 bg-white z-50 shadow-premium transition-transform duration-300 ease-out transform ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        } flex flex-col justify-between p-6`}
      >
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-brand-secondary flex items-center justify-center text-brand-primary shadow-soft">
                <Activity className="h-5 w-5" />
              </div>
              <h2 className="font-extrabold text-sm text-slate-800">MediVerify AI</h2>
            </div>
            <button onClick={() => setDrawerOpen(false)} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-1">
            {[
              { id: 'home', label: 'Dashboard', icon: Activity },
              { id: 'history', label: 'Audit History', icon: FileText },
              { id: 'notifications', label: 'Incident Records', icon: Bell },
              { id: 'faq', label: 'Help & FAQ', icon: HelpCircle },
              { id: 'support', label: 'Security Chat', icon: MessageSquare },
              { id: 'settings', label: 'Security Settings', icon: SettingsIcon },
            ].map((item) => {
              const Icon = item.icon;
              const isSelected = currentScreen === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setCurrentScreen(item.id);
                    setDrawerOpen(false);
                  }}
                  className={`w-full px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center gap-3 transition-all text-left ${
                    isSelected 
                      ? 'bg-brand-secondary text-brand-primary' 
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                  }`}
                >
                  <Icon className="h-4.5 w-4.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-slate-100 pt-4">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="h-8 w-8 rounded-full bg-brand-secondary flex items-center justify-center text-brand-primary font-bold text-xs shrink-0">
              {currentUser.name.charAt(0)}
            </div>
            <div className="truncate">
              <h4 className="text-xs font-bold text-slate-800 truncate">{currentUser.name}</h4>
              <p className="text-[10px] text-slate-400 truncate">{currentUser.email}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full mt-3 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-2xl text-xs font-bold flex items-center gap-3 transition-colors text-left"
          >
            <LogOut className="h-4.5 w-4.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main UI Frame Container (Mobile phone simulator on large screens, fullscreen on mobile) */}
      <div className="w-full max-w-md mx-auto bg-brand-grayBg flex-1 flex flex-col relative md:shadow-premium md:my-4 md:rounded-[40px] md:border md:border-slate-100 overflow-hidden md:max-h-[820px]">
        
        {/* Screen Header */}
        <header className="px-5 py-4 bg-white/80 backdrop-blur-md sticky top-0 z-30 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setDrawerOpen(true)} className="p-1 text-slate-500 hover:text-slate-700 transition-colors btn-press-active">
              <Menu className="h-5 w-5" />
            </button>
            <h1 className="font-extrabold text-sm text-slate-800 capitalize tracking-tight">
              {currentScreen === 'home' ? 'MediVerify AI' : currentScreen}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setCurrentScreen('notifications')}
              className="p-1.5 text-slate-500 hover:text-slate-700 transition-colors relative"
            >
              <Bell className="h-4.5 w-4.5" />
              {flaggedEntries.length > 0 && (
                <span className="absolute top-1 right-1 h-1.5 w-1.5 bg-rose-500 rounded-full animate-ping"></span>
              )}
            </button>
            <div className="flex items-center gap-1.5 bg-brand-secondary border border-emerald-200/50 rounded-full px-2.5 py-1 text-[10px] font-bold text-brand-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Active
            </div>
          </div>
        </header>

        {/* Screen Content Wrapper */}
        <main className="flex-1 overflow-y-auto px-5 py-4">
          {renderScreen()}
        </main>

        {/* Premium Bottom Navigation Bar */}
        <nav className="bg-white/95 backdrop-blur-md border-t border-slate-100/80 px-4 py-3.5 flex justify-between items-center z-30 sticky bottom-0">
          {[
            { id: 'home', label: 'Home', icon: Activity },
            { id: 'scanner', label: 'Scanner', icon: Camera },
            { id: 'statistics', label: 'Stats', icon: BarChart3 },
            { id: 'profile', label: 'Profile', icon: User },
          ].map((tab) => {
            const Icon = tab.icon;
            const isSelected = currentScreen === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setCurrentScreen(tab.id)}
                className="flex flex-col items-center justify-center w-12 group"
              >
                <div className={`h-8 w-8 rounded-full flex items-center justify-center transition-all ${
                  isSelected 
                    ? 'bg-brand-secondary text-brand-primary scale-110' 
                    : 'text-slate-400 group-hover:text-slate-600'
                }`}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className={`text-[9px] mt-1 font-bold ${
                  isSelected ? 'text-brand-primary' : 'text-slate-400'
                }`}>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Background decoration for desktop views */}
      <div className="hidden md:block absolute top-10 left-10 max-w-xs space-y-4">
        <div className="bg-white rounded-3xl p-6 shadow-soft border border-slate-100">
          <h3 className="font-extrabold text-sm text-slate-800">Redesign Sandbox</h3>
          <p className="text-xs text-slate-400 mt-2 leading-relaxed">
            You are exploring the redesigned **MediVerify AI** interface simulating a native iOS/Android client.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button 
              onClick={() => {
                window.open(AWS_CONFIG.apiUrl, '_blank');
              }}
              className="px-4 py-2 bg-brand-secondary hover:bg-emerald-100 text-brand-primary text-[11px] font-bold rounded-xl text-center transition-colors"
            >
              Open AWS API Gateway Endpoint
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
