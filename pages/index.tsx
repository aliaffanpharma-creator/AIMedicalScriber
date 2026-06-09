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

export default function Home() {
  // ---------- Core app state (unchanged logic) ----------
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

  // ---------- UI navigation & polish ----------
  type Screen = 'login' | 'home' | 'recording' | 'processing' | 'soap' | 'history' | 'settings';
  const [currentScreen, setCurrentScreen] = useState<Screen>('login');
  const [darkRecording, setDarkRecording] = useState(false);
  const [waveform, setWaveform] = useState<number[]>(Array(30).fill(10));
  const [recordingTimer, setRecordingTimer] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    subjective: true, objective: true, assessment: true, plan: true
  });
  const [processingStage, setProcessingStage] = useState(0); // 0=transcribe,1=analyze,2=generate

  // ---------- Load patients ----------
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
    await localforage.setItem(id, { id, ...patientData, date: Date.now() });
    await loadPatients();
    return id;
  }

  // ---------- Recording & AI (exact same logic but with UI feedback) ----------
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
        if (timerRef.current) clearInterval(timerRef.current);
        setRecordingTimer(0);
        setRecording(false);
      }
    };
    mediaRecorderRef.current.start();
    setRecording(true);
    setCurrentScreen('recording');
    timerRef.current = setInterval(() => {
      setRecordingTimer(prev => prev + 1);
    }, 1000);
    const waveInterval = setInterval(() => {
      setWaveform(Array(30).fill(0).map(() => Math.floor(Math.random() * 40) + 8));
    }, 120);
    return () => clearInterval(waveInterval);
  }

  function stopRecording() {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      setRecording(false);
    }
  }

  async function handleSaveRecord() {
    if (!patientName.trim()) return alert('Enter patient name');
    const finalNote = editableNote || generatedNote;
    if (!finalNote) return alert('No note to save');
    await savePatientToDB({ name: patientName, age: patientAge, gender: patientGender, specialty, note: finalNote, transcript });
    alert('Saved!');
    setCurrentScreen('home');
  }

  async function exportToPDF() {
    const element = document.getElementById('note-preview');
    if (!element) return;
    const html2pdf = (await import('html2pdf.js')).default;
    html2pdf().set({ margin: 0.5, filename: `consultation_${patientName}.pdf` }).from(element).save();
  }

  const formatTime = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;
  const formatPatientId = (id: string) => `PT-${id.slice(-6)}`;

  // ---------- SCREENS (highly polished, glassmorphism, animations) ----------
  const LoginScreen = () => (
    <div className="min-h-screen bg-gradient-to-br from-[#1A2B4A] to-[#0F1A2E] flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white/10 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/20">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-[#2D7DD2] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <i className="fas fa-microphone-alt text-white text-3xl"></i>
          </div>
          <h1 className="text-2xl font-bold text-white">AI Medical Scriber</h1>
          <p className="text-white/70 mt-1">Secure clinical documentation</p>
        </div>
        <div className="space-y-4">
          <input type="email" placeholder="Hospital email" className="w-full p-4 bg-white/20 border border-white/30 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#2D7DD2]" />
          <input type="password" placeholder="Password" className="w-full p-4 bg-white/20 border border-white/30 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#2D7DD2]" />
          <button onClick={() => setCurrentScreen('home')} className="w-full bg-[#2D7DD2] hover:bg-[#1E5A9E] text-white font-semibold py-4 rounded-xl transition-all shadow-md">Log in</button>
          <button className="w-full border border-white/30 py-4 rounded-xl flex items-center justify-center gap-2 text-white"><i className="fas fa-fingerprint"></i> Use Face ID</button>
        </div>
      </div>
    </div>
  );

  const HomeScreen = () => (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-white/80 backdrop-blur-sm sticky top-0 z-10 p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-[#1A2B4A]">Good morning, Dr. Ahmed</h1>
        <p className="text-gray-500 mt-1">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · 8 patients today</p>
      </div>
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="font-semibold text-gray-700 mb-3">Recent sessions</h2>
          {patients.slice(0, 3).map(pat => (
            <div key={pat.id} className="flex justify-between items-center py-3 border-b last:border-0">
              <div><p className="font-medium">{formatPatientId(pat.id)}</p><p className="text-xs text-gray-400">{new Date(pat.date).toLocaleTimeString()}</p></div>
              <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">Reviewed</span>
            </div>
          ))}
        </div>
      </div>
      <button onClick={startRecording} className="fixed bottom-24 right-6 w-16 h-16 bg-red-500 rounded-full shadow-xl flex items-center justify-center text-white text-2xl hover:scale-105 transition-all animate-pulse"><i className="fas fa-microphone"></i></button>
      <BottomNav current="home" setScreen={setCurrentScreen} />
    </div>
  );

  const RecordingScreen = () => (
    <div className={`min-h-screen transition-colors duration-300 ${darkRecording ? 'bg-[#0F172A] text-white' : 'bg-white'}`}>
      <div className="flex justify-between p-6 items-center">
        <button onClick={() => { setCurrentScreen('home'); if (recording) stopRecording(); }}><i className="fas fa-arrow-left text-xl"></i></button>
        <button onClick={() => setDarkRecording(!darkRecording)}><i className={`fas ${darkRecording ? 'fa-sun' : 'fa-moon'} text-xl`}></i></button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 mt-20">
        <div className="text-center mb-10">
          <p className="text-sm opacity-70">Recording · {formatTime(recordingTimer)}</p>
          <div className="flex gap-1 mt-6 h-16 items-center justify-center">
            {waveform.map((h, i) => (
              <div key={i} className="w-1.5 bg-[#2D7DD2] rounded-full transition-all duration-75" style={{ height: `${h}px` }}></div>
            ))}
          </div>
        </div>
        <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl p-5 w-full max-h-64 overflow-y-auto shadow-inner">
          <p className="text-sm font-mono">{transcript || "Doctor: What brings you today?\nPatient: I've had a persistent cough and fever for three days..."}</p>
        </div>
      </div>
      <div className="p-8 flex justify-center">
        <button onClick={stopRecording} className="w-20 h-20 bg-red-600 rounded-full flex items-center justify-center text-white text-2xl shadow-lg hover:scale-105 transition"><i className="fas fa-stop"></i></button>
      </div>
    </div>
  );

  const ProcessingScreen = () => (
    <div className="min-h-screen bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center p-6">
      <div className="relative w-28 h-28">
        <div className="absolute inset-0 border-4 border-gray-200 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-[#2D7DD2] rounded-full border-t-transparent animate-spin"></div>
        <div className="absolute inset-0 flex items-center justify-center text-3xl font-bold text-[#2D7DD2]">
          {processingStage === 0 ? '🎤' : processingStage === 1 ? '🧠' : '📋'}
        </div>
      </div>
      <p className="text-xl font-semibold mt-8">
        {processingStage === 0 ? 'Transcribing...' : processingStage === 1 ? 'Analyzing...' : 'Generating SOAP note'}
      </p>
      <p className="text-gray-500 mt-2">AI is working on your consultation</p>
      <button onClick={() => setCurrentScreen('home')} className="mt-10 text-[#2D7DD2] font-medium">Cancel</button>
    </div>
  );

  const SoapScreen = () => (
    <div className="bg-gray-50 min-h-screen pb-28">
      <div className="sticky top-0 bg-white/80 backdrop-blur-sm p-4 border-b flex justify-between items-center z-10">
        <button onClick={() => setCurrentScreen('home')}><i className="fas fa-arrow-left text-xl"></i></button>
        <h1 className="font-bold text-lg">SOAP Note</h1>
        <button onClick={exportToPDF}><i className="fas fa-share-alt text-xl text-[#2D7DD2]"></i></button>
      </div>
      <div className="p-4 space-y-4">
        {['subjective', 'objective', 'assessment', 'plan'].map(section => (
          <div key={section} className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <button onClick={() => setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))} className="w-full flex justify-between items-center p-4 font-semibold capitalize bg-gray-50 border-b">
              {section} <i className={`fas fa-chevron-${expandedSections[section] ? 'up' : 'down'} transition-transform`}></i>
            </button>
            {expandedSections[section] && (
              <div className="p-4">
                <textarea className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-[#2D7DD2]" rows={4} value={editableNote} onChange={e => setEditableNote(e.target.value)} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t flex gap-3">
        <button onClick={handleSaveRecord} className="flex-1 bg-[#2D7DD2] text-white py-3 rounded-xl font-semibold shadow-md">Save to history</button>
        <button onClick={exportToPDF} className="flex-1 border border-[#2D7DD2] text-[#2D7DD2] py-3 rounded-xl font-semibold">Export PDF</button>
      </div>
      <div id="note-preview" className="hidden p-6 bg-white"><pre>{editableNote}</pre></div>
    </div>
  );

  const HistoryScreen = () => (
    <div className="bg-gray-50 min-h-screen pb-24">
      <div className="bg-white/80 backdrop-blur-sm sticky top-0 p-4 border-b">
        <input type="search" placeholder="Search by name or ID..." className="w-full p-3 border rounded-xl pl-10 focus:ring-2 focus:ring-[#2D7DD2]" />
        <i className="fas fa-search absolute left-7 top-7 text-gray-400"></i>
      </div>
      <div className="p-4 space-y-3">
        {patients.map(pat => (
          <div key={pat.id} className="bg-white rounded-xl p-4 shadow-sm flex justify-between items-center hover:shadow-md transition">
            <div>
              <p className="font-medium">{pat.name || formatPatientId(pat.id)}</p>
              <p className="text-xs text-gray-500">{new Date(pat.date).toLocaleString()}</p>
              <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">Reviewed</span>
            </div>
            <button onClick={() => { setPatientName(pat.name); setPatientAge(pat.age); setPatientGender(pat.gender); setSpecialty(pat.specialty); setEditableNote(pat.note); setGeneratedNote(pat.note); setCurrentScreen('soap'); }} className="text-[#2D7DD2]"><i className="fas fa-eye"></i></button>
          </div>
        ))}
      </div>
      <BottomNav current="history" setScreen={setCurrentScreen} />
    </div>
  );

  const SettingsScreen = () => (
    <div className="bg-gray-50 min-h-screen pb-24">
      <div className="bg-white/80 backdrop-blur-sm p-6 border-b"><h1 className="text-xl font-bold text-[#1A2B4A]">Settings</h1></div>
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-xl p-4"><p className="font-medium">Dr. Ahmed Khan</p><p className="text-sm text-gray-500">Cardiology · City Hospital</p></div>
        <div className="bg-white rounded-xl p-4 flex justify-between items-center"><span>Language</span><span>English <i className="fas fa-chevron-right ml-2 text-xs"></i></span></div>
        <div className="bg-white rounded-xl p-4 flex justify-between items-center"><span>EHR Integration</span><div className="w-12 h-6 bg-[#2D7DD2] rounded-full relative"><div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div></div></div>
        <div className="bg-white rounded-xl p-4 flex justify-between items-center"><span>Notifications</span><div className="w-12 h-6 bg-gray-300 rounded-full"></div></div>
        <button onClick={() => setCurrentScreen('login')} className="w-full bg-red-50 text-red-600 py-3 rounded-xl">Log out</button>
      </div>
      <BottomNav current="settings" setScreen={setCurrentScreen} />
    </div>
  );

  const BottomNav = ({ current, setScreen }: { current: string; setScreen: (s: Screen) => void }) => (
    <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t flex justify-around items-center py-2 shadow-lg">
      {['home', 'history', 'settings'].map(icon => (
        <button key={icon} onClick={() => setScreen(icon as Screen)} className={`flex flex-col items-center py-2 px-5 rounded-xl transition ${current === icon ? 'text-[#2D7DD2] bg-blue-50' : 'text-gray-400'}`}>
          <i className={`fas fa-${icon === 'home' ? 'home' : icon === 'history' ? 'history' : 'user'} text-xl`}></i>
          <span className="text-xs mt-1 capitalize">{icon}</span>
        </button>
      ))}
      <button onClick={startRecording} className="bg-red-500 text-white p-3 rounded-full -mt-8 shadow-lg hover:scale-105 transition"><i className="fas fa-microphone text-xl"></i></button>
    </div>
  );

  // Router
  switch (currentScreen) {
    case 'login': return <LoginScreen />;
    case 'home': return <HomeScreen />;
    case 'recording': return <RecordingScreen />;
    case 'processing': return <ProcessingScreen />;
    case 'soap': return <SoapScreen />;
    case 'history': return <HistoryScreen />;
    case 'settings': return <SettingsScreen />;
    default: return <HomeScreen />;
  }
}
