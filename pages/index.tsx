import React, { useState, useRef, useEffect } from 'react';
import localforage from 'localforage';
import html2pdf from 'html2pdf.js';

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

  // Load patients from IndexedDB on mount
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

  async function startRecording() {
    audioChunksRef.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorderRef.current = new MediaRecorder(stream);
    mediaRecorderRef.current.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunksRef.current.push(event.data);
    };
    mediaRecorderRef.current.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      setIsProcessing(true);
      try {
        // Upload to /api/transcribe
        const formData = new FormData();
        formData.append('file', audioBlob, 'recording.webm');
        const transcribeRes = await fetch('/api/transcribe', { method: 'POST', body: formData });
        if (!transcribeRes.ok) throw new Error('Transcription failed');
        const { transcript: rawTranscript } = await transcribeRes.json();
        setTranscript(rawTranscript);

        // Generate note
        const noteRes = await fetch('/api/generate-note', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: rawTranscript, specialty }),
        });
        if (!noteRes.ok) throw new Error('Note generation failed');
        const { note } = await noteRes.json();
        setGeneratedNote(note);
        setEditableNote(note);
      } catch (err: any) {
        alert('Error: ' + err.message);
      } finally {
        setIsProcessing(false);
        stream.getTracks().forEach(track => track.stop());
      }
    };
    mediaRecorderRef.current.start();
    setRecording(true);
  }

  function stopRecording() {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
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
  }

  function loadPatient(patient: Patient) {
    setPatientName(patient.name);
    setPatientAge(patient.age);
    setPatientGender(patient.gender);
    setSpecialty(patient.specialty);
    setGeneratedNote(patient.note);
    setEditableNote(patient.note);
    setTranscript(patient.transcript || '');
  }

  function exportToPDF() {
    const element = document.getElementById('note-preview-container');
    if (!element) return;
    const opt = {
      margin: 0.5,
      filename: `consultation_${patientName || 'patient'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
    };
    html2pdf().set(opt).from(element).save();
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        <header className="bg-blue-700 text-white p-4 rounded-xl shadow mb-6">
          <h1 className="text-2xl md:text-3xl font-bold">🩺 AI Medical Scriber – Pakistan</h1>
          <p className="text-blue-100">Record → AI SOAP Note → PDF & Local Records</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Panel */}
          <div className="lg:col-span-1 space-y-5">
            <div className="bg-white p-4 rounded-xl shadow">
              <h2 className="font-semibold text-lg mb-3">1. Patient Info</h2>
              <input
                type="text"
                placeholder="Full Name"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                className="w-full border rounded p-2 mb-2"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Age"
                  value={patientAge}
                  onChange={(e) => setPatientAge(e.target.value)}
                  className="w-1/2 border rounded p-2"
                />
                <select
                  value={patientGender}
                  onChange={(e) => setPatientGender(e.target.value)}
                  className="w-1/2 border rounded p-2"
                >
                  <option>M</option>
                  <option>F</option>
                  <option>Other</option>
                </select>
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl shadow">
              <h2 className="font-semibold text-lg mb-3">2. Specialty Template</h2>
              <select
                value={specialty}
                onChange={(e) => setSpecialty(e.target.value)}
                className="w-full border rounded p-2"
              >
                <option>General Practice</option>
                <option>Cardiology</option>
                <option>Gynecology</option>
                <option>Pediatrics</option>
                <option>Psychiatry</option>
              </select>
            </div>

            <div className="bg-white p-4 rounded-xl shadow">
              <h2 className="font-semibold text-lg mb-3">3. Recording</h2>
              <div className="flex gap-3">
                <button
                  onClick={startRecording}
                  disabled={recording}
                  className={`flex-1 py-2 rounded font-bold ${
                    recording ? 'bg-gray-400' : 'bg-red-600 hover:bg-red-700 text-white'
                  }`}
                >
                  <i className="fas fa-microphone mr-2"></i>Start
                </button>
                <button
                  onClick={stopRecording}
                  disabled={!recording}
                  className={`flex-1 py-2 rounded font-bold ${
                    !recording ? 'bg-gray-400' : 'bg-yellow-600 hover:bg-yellow-700 text-white'
                  }`}
                >
                  <i className="fas fa-stop mr-2"></i>Stop
                </button>
              </div>
              {isProcessing && (
                <div className="mt-3 text-blue-600 text-center">
                  <i className="fas fa-spinner fa-pulse"></i> Transcribing & generating note...
                </div>
              )}
              {transcript && (
                <div className="mt-3 text-xs text-gray-500 border-t pt-2">
                  <strong>Raw transcript:</strong> {transcript.substring(0, 150)}...
                </div>
              )}
            </div>

            <div className="bg-white p-4 rounded-xl shadow">
              <h2 className="font-semibold text-lg mb-3">4. Actions</h2>
              <button
                onClick={handleSaveRecord}
                className="w-full bg-green-600 text-white py-2 rounded mb-2 hover:bg-green-700"
              >
                <i className="fas fa-save mr-2"></i>Save Patient Record
              </button>
              <button
                onClick={exportToPDF}
                className="w-full bg-purple-600 text-white py-2 rounded hover:bg-purple-700"
              >
                <i className="fas fa-file-pdf mr-2"></i>Export PDF
              </button>
            </div>
          </div>

          {/* Middle Panel – Editable Note */}
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white p-4 rounded-xl shadow">
              <h2 className="font-semibold text-lg mb-2 flex justify-between">
                <span>📋 AI Generated SOAP Note</span>
                <span className="text-xs text-gray-400">Editable</span>
              </h2>
              <textarea
                rows={14}
                value={editableNote}
                onChange={(e) => setEditableNote(e.target.value)}
                className="w-full border rounded p-3 font-mono text-sm"
                placeholder="Generated note will appear here. You can edit before saving."
              />
            </div>

            {/* Hidden PDF container */}
            <div id="note-preview-container" className="hidden">
              <div className="p-6 bg-white" style={{ fontFamily: 'Arial' }}>
                <h2 className="text-xl font-bold">Clinical Consultation Note</h2>
                <p>
                  <strong>Patient:</strong> {patientName || '____'} | <strong>Age:</strong> {patientAge} |{' '}
                  <strong>Gender:</strong> {patientGender}
                </p>
                <p>
                  <strong>Specialty:</strong> {specialty} | <strong>Date:</strong> {new Date().toLocaleDateString()}
                </p>
                <hr className="my-2" />
                <div className="whitespace-pre-wrap text-sm">{editableNote || 'No note generated.'}</div>
                <hr className="my-2" />
                <p className="text-xs text-gray-500 mt-4">
                  Generated by AI Medical Scriber – Doctor's signature & stamp
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Patient History */}
        <div className="mt-8 bg-white rounded-xl shadow p-4">
          <h2 className="font-semibold text-xl mb-3">📚 Previous Patient Records</h2>
          {patients.length === 0 && <p className="text-gray-400">No records yet. Save a consultation.</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {patients.map((pat) => (
              <div
                key={pat.id}
                onClick={() => loadPatient(pat)}
                className="border rounded-lg p-3 cursor-pointer hover:bg-gray-50 transition"
              >
                <div className="font-bold">
                  {pat.name} ({pat.age}, {pat.gender})
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(pat.date).toLocaleString()} – {pat.specialty}
                </div>
                <div className="text-sm truncate">{pat.note.substring(0, 80)}...</div>
              </div>
            ))}
          </div>
        </div>

        <footer className="text-center text-gray-400 text-sm mt-8">
          Secure local storage (IndexedDB) – no data leaves your browser except AI APIs.
        </footer>
      </div>
    </div>
  );
}
