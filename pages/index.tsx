import React, { useState, useRef, useEffect } from 'react';
import localforage from 'localforage';

type Patient = {
  id: string;
  name: string;
  age: string;
  gender: string;
  specialty: string;
  note: string;
  transcript: string;
  date: number;
};

// ---------- Helper to format patient ID ----------
function formatPatientId(id: string) {
  return `PT-${id.slice(-6)}`;
}

export default function Home() {
  // ---------- Existing state (from original app) ----------
  const [specialty, setSpecialty] = useState('General Practice');
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [generatedNote, setGeneratedNote] = useState('');
  const [editableNote, setEditableNote] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [patientGender, setPatientGender] = useState('M');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // ---------- UI navigation state ----------
  type Screen = 'login' | 'home' | 'recording' | 'processing' | 'soap' | 'history' | 'settings';
  const [currentScreen, setCurrentScreen] = useState<Screen>('login');
  const [darkRecording, setDarkRecording] = useState(false);
  const [waveformAmplitude, setWaveformAmplitude] = useState<number[]>(Array(20).fill(10));
  const [recordingTimer, setRecordingTimer] = useState(0);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    subjective: true,
    objective: true,
    assessment: true,
    plan: true,
  });
  const [processingStage, setProcessingStage] = useState(0); // 0=transcribing,1=analyzing,2=soap
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // ---------- Load patients from IndexedDB ----------
  useEffect(() => {
    localforage.config({ name: 'MedicalScriberDB', storeName: 'patients' });
    loadPatients();
  }, []);

  async function loadPatients() {
    const allPatients: Patient[] = [];
    await localforage.iterate((value, key) => {
      allPatients.push({ id: key as string, ...(value as any) });
    });
    allPatients.sort((a, b) => b.date - a.date);
    setPatients(allPatients);
  }

  async function savePatientToDB(patientData: Omit<Patient, 'id' | 'date'>) {
    const id = Date.now().toString();
    const record: Patient = {
      id,
      ...patientData,
      date: Date.now(),
    };
    await localforage.setItem(id, record);
    await loadPatients();
    return id;
  }

  // ---------- Recording & AI logic (same as before, but adapted) ----------
  async function startRecording() {
    audioChunksRef.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorderRef.current = new MediaRecorder(stream);
    mediaRecorderRef.current.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };
    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      setCurrentScreen('processing');
      setProcessingStage(0);
      setIsProcessing(true);
      try {
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.webm');
        const transcribeRes = await fetch('/api/transcribe', { method: 'POST', body: formData });
        if (!transcribeRes.ok) throw new Error('Transcription failed');
        const { transcript: rawTranscript } = await transcribeRes.json();
        setTranscript(rawTranscript);
        setProcessingStage(1);

        const noteRes = await fetch('/api/generate-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: rawTranscript, specialty }),
        });
        if (!noteRes.ok) throw new Error('Note generation failed');
        const { note } = await noteRes.json();
        setGeneratedNote(note);
        setEditableNote(note);
        setProcessingStage(2);
        setTimeout(() => {
          setCurrentScreen('soap');
          setIsProcessing(false);
        }, 800);
      } catch (err: any) {
        alert('Error: ' + err.message);
        setCurrentScreen('home');
        setIsProcessing(false);
      } finally {
        stream.getTracks().forEach(track => track.stop());
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
        setRecordingTimer(0);
        setRecording(false);
      }
    };
    mediaRecorderRef.current.start();
    setRecording(true);
    setCurrentScreen('recording');
    // start timer
    timerIntervalRef.current = setInterval(() => {
      setRecordingTimer(prev => prev + 1);
    }, 1000);
    // fake waveform animation
    const interval = setInterval(() => {
      setWaveformAmplitude(Array(20).fill(0).map(() => Math.floor(Math.random() * 40) + 5));
    }, 150);
    return () => clearInterval(interval);
  }

  function stopRecording() {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      setRecording(false);
    }
  }

  async function handleSaveRecord() {
    if (!patientName.trim()) {
      alert('Please enter patient name');
      return;
    }
    const finalNote = editableNote || generatedNote;
    if (!finalNote) {
      alert('No note to save. Generate a note first.');
      return;
    }
    await savePatientToDB({
      name: patientName,
      age: patientAge,
      gender: patientGender,
      specialty,
      note: finalNote,
      transcript,
    });
    alert('Patient record saved!');
    setCurrentScreen('home');
  }

  async function exportToPDF() {
    const element = document.getElementById('note-preview-container');
    if (!element) return;
    const html2pdf = (await import('html2pdf.js')).default;
    const opt = {
      margin: 0.5,
      filename: `consultation_${patientName || 'patient'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
    };
    html2pdf().set(opt).from(element).save();
  }

  // Helper to format timer
  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const remainSec = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${remainSec.toString().padStart(2, '0')}`;
  };

  // ---------- UI Components per screen ----------
  const renderLogin = () => (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gradient-to-br from-white to-gray-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <i className="fas fa-microphone-alt text-white text-3xl"></i>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">AI Medical Scriber</h1>
          <p className="text-gray-500 mt-1">Secure clinical documentation</p>
        </div>
        <div className="space-y-4">
          <input type="email" placeholder="Hospital email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} className="w-full p-4 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <input type="password" placeholder="Password" value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} className="w-full p-4 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400" />
          <button onClick={() => setCurrentScreen('home')} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 rounded-xl transition-all shadow-md">Log in</button>
          <button className="w-full border border-gray-300 py-4 rounded-xl flex items-center justify-center gap-2"><i className="fas fa-fingerprint text-blue-600"></i> Use Face ID / Biometric</button>
          <p className="text-center text-sm text-gray-500 mt-4"><a href="#" className="text-blue-600">Forgot password?</a> · <a href="#" className="text-blue-600">SSO with hospital</a></p>
        </div>
      </div>
    </div>
  );

  const renderHome = () => (
    <div className="bg-gray-50 min-h-screen pb-20">
      <div className="bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-gray-800">Good morning, Dr. Ahmed</h1>
        <p className="text-gray-500 mt-1">{new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · 8 patients today</p>
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h2 className="font-semibold text-gray-700 mb-2">Recent sessions</h2>
          {patients.slice(0, 3).map(pat => (
            <div key={pat.id} className="flex justify-between items-center py-3 border-b last:border-0">
              <div><p className="font-medium">{formatPatientId(pat.id)}</p><p className="text-xs text-gray-400">{new Date(pat.date).toLocaleTimeString()}</p></div>
              <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">Reviewed</span>
            </div>
          ))}
        </div>
      </div>
      <button onClick={startRecording} className="fixed bottom-24 right-6 w-16 h-16 bg-red-500 rounded-full shadow-xl flex items-center justify-center text-white text-2xl hover:scale-105 transition"><i className="fas fa-microphone"></i></button>
      <BottomNav current="home" setScreen={setCurrentScreen} />
    </div>
  );

  const renderRecording = () => (
    <div className={`min-h-screen flex flex-col ${darkRecording ? 'bg-gray-900 text-white' : 'bg-white'}`}>
      <div className="flex justify-between p-6 items-center">
        <button onClick={() => { setCurrentScreen('home'); if(recording) stopRecording(); }}><i className="fas fa-arrow-left text-xl"></i></button>
        <button onClick={() => setDarkRecording(!darkRecording)}><i className={`fas ${darkRecording ? 'fa-sun' : 'fa-moon'} text-xl`}></i></button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="text-center mb-8">
          <p className="text-sm opacity-70">Recording · {formatTime(recordingTimer)}</p>
          <div className="flex gap-1 mt-4 h-12 items-center justify-center">
            {waveformAmplitude.map((h, idx) => <div key={idx} className="w-2 bg-blue-500 rounded-full transition-all duration-75" style={{ height: `${Math.min(40, Math.max(8, h))}px` }}></div>)}
          </div>
        </div>
        <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl p-4 w-full max-h-64 overflow-y-auto">
          <p className="text-sm font-mono">{transcript || "Doctor: What brings you today?\nPatient: I've had a cough for two weeks..."}</p>
        </div>
      </div>
      <div className="p-8 flex justify-center">
        <button onClick={stopRecording} className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center text-white text-2xl shadow-lg"><i className="fas fa-stop"></i></button>
      </div>
    </div>
  );

  const renderProcessing = () => (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6">
      <div className="w-24 h-24 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin mb-6"></div>
      <p className="text-xl font-semibold">{processingStage === 0 ? 'Transcribing conversation...' : processingStage === 1 ? 'Analyzing medical content...' : 'Generating SOAP note...'}</p>
      <p className="text-gray-500 mt-2">Please wait, AI is working</p>
      <button onClick={() => setCurrentScreen('home')} className="mt-8 text-blue-600">Cancel</button>
    </div>
  );

  const renderSoap = () => (
    <div className="bg-gray-50 min-h-screen pb-24">
      <div className="sticky top-0 bg-white p-4 border-b flex justify-between items-center">
        <button onClick={() => setCurrentScreen('home')}><i className="fas fa-arrow-left text-xl"></i></button>
        <h1 className="font-bold text-lg">SOAP Note</h1>
        <button onClick={exportToPDF}><i className="fas fa-share-alt text-xl text-blue-600"></i></button>
      </div>
      <div className="p-4 space-y-4">
        {['subjective', 'objective', 'assessment', 'plan'].map(section => (
          <div key={section} className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <button onClick={() => setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))} className="w-full flex justify-between items-center p-4 font-semibold capitalize bg-gray-50">{section} <i className={`fas fa-chevron-${expandedSections[section] ? 'up' : 'down'}`}></i></button>
            {expandedSections[section] && <div className="p-4 border-t"><textarea className="w-full p-2 border rounded-lg" rows={4} value={editableNote.split('\n').find(l => l.toLowerCase().includes(section)) || ''} onChange={e => setEditableNote(e.target.value)} /></div>}
          </div>
        ))}
      </div>
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t flex gap-3">
        <button onClick={handleSaveRecord} className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-semibold">Save to history</button>
        <button onClick={exportToPDF} className="flex-1 border border-blue-600 text-blue-600 py-3 rounded-xl font-semibold">Export PDF</button>
      </div>
      <div id="note-preview-container" className="hidden"><div>{editableNote}</div></div>
    </div>
  );

  const renderHistory = () => (
    <div className="bg-gray-50 min-h-screen pb-20">
      <div className="bg-white p-4 border-b sticky top-0"><input type="search" placeholder="Search patients..." className="w-full p-3 border rounded-xl" /></div>
      <div className="p-4 space-y-3">
        {patients.map(pat => (
          <div key={pat.id} className="bg-white rounded-xl p-4 shadow-sm flex justify-between items-center">
            <div><p className="font-medium">{formatPatientId(pat.id)}</p><p className="text-xs text-gray-500">{new Date(pat.date).toLocaleString()}</p><span className="text-xs text-green-600">Reviewed</span></div>
            <button onClick={() => { setPatientName(pat.name); setPatientAge(pat.age); setPatientGender(pat.gender); setSpecialty(pat.specialty); setEditableNote(pat.note); setGeneratedNote(pat.note); setCurrentScreen('soap'); }} className="text-blue-600"><i className="fas fa-eye"></i></button>
          </div>
        ))}
      </div>
      <BottomNav current="history" setScreen={setCurrentScreen} />
    </div>
  );

  const renderSettings = () => (
    <div className="bg-gray-50 min-h-screen pb-20">
      <div className="bg-white p-6 border-b"><h1 className="text-xl font-bold">Settings</h1></div>
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-xl p-4"><p className="font-medium">Dr. Ahmed Khan</p><p className="text-sm text-gray-500">Cardiology · City Hospital</p></div>
        <div className="bg-white rounded-xl p-4 flex justify-between"><span>Language</span><span>English <i className="fas fa-chevron-right ml-2"></i></span></div>
        <div className="bg-white rounded-xl p-4 flex justify-between"><span>EHR Integration</span><div className="w-10 h-6 bg-blue-600 rounded-full relative"><div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div></div></div>
        <div className="bg-white rounded-xl p-4 flex justify-between"><span>Notifications</span><div className="w-10 h-6 bg-gray-300 rounded-full"></div></div>
        <button onClick={() => setCurrentScreen('login')} className="w-full bg-red-50 text-red-600 py-3 rounded-xl">Log out</button>
      </div>
      <BottomNav current="settings" setScreen={setCurrentScreen} />
    </div>
  );

  const BottomNav = ({ current, setScreen }: { current: string, setScreen: (s: Screen) => void }) => (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around py-2">
      {['home', 'history', 'settings'].map(icon => (
        <button key={icon} onClick={() => setScreen(icon as Screen)} className={`flex flex-col items-center py-2 px-6 rounded-full ${current === icon ? 'text-blue-600' : 'text-gray-400'}`}>
          <i className={`fas fa-${icon === 'home' ? 'home' : icon === 'history' ? 'history' : 'user'} text-xl`}></i>
          <span className="text-xs mt-1 capitalize">{icon}</span>
        </button>
      ))}
      <button onClick={startRecording} className="bg-red-500 text-white p-3 rounded-full -mt-6 shadow-lg"><i className="fas fa-microphone text-xl"></i></button>
    </div>
  );

  // Routing
  switch (currentScreen) {
    case 'login': return renderLogin();
    case 'home': return renderHome();
    case 'recording': return renderRecording();
    case 'processing': return renderProcessing();
    case 'soap': return renderSoap();
    case 'history': return renderHistory();
    case 'settings': return renderSettings();
    default: return renderHome();
  }
}
