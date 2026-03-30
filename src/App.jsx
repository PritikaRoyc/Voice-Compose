import { useState, useRef } from 'react'
import './App.css'

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY
const CLAUDE_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY

function App() {
  const [status, setStatus] = useState('idle')
  const [transcript, setTranscript] = useState('')
  const [emailDraft, setEmailDraft] = useState({ subject: '', body: '' })
  const [recipient, setRecipient] = useState('')
  const [showEditBox, setShowEditBox] = useState(false)
  const [editInstruction, setEditInstruction] = useState('')
  const [isEditRecording, setIsEditRecording] = useState(false)
  const [isEditTranscribing, setIsEditTranscribing] = useState(false)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const emailDraftRef = useRef({ subject: '', body: '' })
  const editRecorderRef = useRef(null)
  const editChunksRef = useRef([])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []
      mediaRecorder.ondataavailable = (e) => {
        audioChunksRef.current.push(e.data)
      }
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        await transcribeAudio(audioBlob)
      }
      mediaRecorder.start()
      setStatus('recording')
    } catch (err) {
      alert('Microphone access denied. Please allow mic access and try again.')
      setStatus('idle')
    }
  }

  const stopRecording = () => {
    mediaRecorderRef.current.stop()
    setStatus('processing')
  }

  const startEditRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      editRecorderRef.current = mediaRecorder
      editChunksRef.current = []
      mediaRecorder.ondataavailable = (e) => {
        editChunksRef.current.push(e.data)
      }
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(editChunksRef.current, { type: 'audio/webm' })
        await transcribeEditAudio(audioBlob)
      }
      mediaRecorder.start()
      setIsEditRecording(true)
    } catch (err) {
      alert('Microphone access denied.')
      setIsEditRecording(false)
    }
  }

  const stopEditRecording = () => {
    editRecorderRef.current.stop()
    setIsEditRecording(false)
  }

  const transcribeEditAudio = async (audioBlob) => {
    try {
      setIsEditTranscribing(true)
      const formData = new FormData()
      formData.append('file', audioBlob, 'recording.webm')
      formData.append('model', 'whisper-large-v3')
      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: formData
      })
      const data = await response.json()
      setEditInstruction(data.text)
    } catch (err) {
      alert('Transcription failed.')
    } finally {
      setIsEditTranscribing(false)
    }
  }

  const transcribeAudio = async (audioBlob) => {
    try {
      const formData = new FormData()
      formData.append('file', audioBlob, 'recording.webm')
      formData.append('model', 'whisper-large-v3')
      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}` },
        body: formData
      })
      const data = await response.json()
      const text = data.text
      setTranscript(text)
      await composeEmail(text)
    } catch (err) {
      alert('Transcription failed. Check your Groq API key.')
      setStatus('idle')
    }
  }

  const composeEmail = async (transcriptText) => {
    try {
      setStatus('composing')
      const currentDraft = emailDraftRef.current
      const isFirstDraft = !currentDraft.subject && !currentDraft.body

      const systemPrompt = `You are an email assistant. You help users compose and refine emails through voice.

Your job:
- If this is the FIRST message, treat it as dictation and compose a fresh email from it
- If there is an EXISTING draft, treat the new message as an INSTRUCTION to refine it
- Always return ONLY a JSON object, nothing else

Return format:
{
  "subject": "email subject here",
  "body": "full email body here with proper greeting and sign off"
}`

      const userMessage = isFirstDraft
        ? `Compose a professional email from this voice note: "${transcriptText}"`
        : `Here is the current email draft:
Subject: ${currentDraft.subject}
Body: ${currentDraft.body}

The user said: "${transcriptText}"

This is an instruction to refine the draft. Update the draft accordingly and return the full updated email.`

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': CLAUDE_API_KEY,
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }]
        })
      })

      const data = await response.json()
      if (data.error) {
        alert('Claude error: ' + data.error.message)
        setStatus('idle')
        return
      }

      const content = data.content[0].text
      const cleaned = content.replace(/```json|```/g, '').trim()
      const sanitized = cleaned.replace(/"((?:[^"\\]|\\[\s\S])*)"/g, (match) =>
        match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
      )
      const email = JSON.parse(sanitized)
      emailDraftRef.current = email
      setEmailDraft(email)
      setStatus('done')
    } catch (err) {
      alert('Email composition failed: ' + err.message)
      setStatus('idle')
    }
  }

  const openInGmail = () => {
    const params = new URLSearchParams({
      to: recipient,
      su: emailDraft.subject,
      body: emailDraft.body
    })
    window.open(`https://mail.google.com/mail/?view=cm&fs=1&${params.toString()}`, '_blank')
  }

  const resetDraft = () => {
    if (editRecorderRef.current && isEditRecording) {
      editRecorderRef.current.stop()
    }
    emailDraftRef.current = { subject: '', body: '' }
    setEmailDraft({ subject: '', body: '' })
    setTranscript('')
    setRecipient('')
    setShowEditBox(false)
    setEditInstruction('')
    setIsEditRecording(false)
    setIsEditTranscribing(false)
    setStatus('idle')
  }

  const handleTextEdit = async () => {
    if (!editInstruction.trim()) return
    setShowEditBox(false)
    await composeEmail(editInstruction)
    setEditInstruction('')
  }

  const copyToClipboard = () => {
    const full = `Subject: ${emailDraft.subject}\n\n${emailDraft.body}`
    navigator.clipboard.writeText(full)
    alert('Copied to clipboard! Paste it into Gmail.')
  }

  return (
    <div className="app">
      <h1>Voice Gmail</h1>
      <p className="subtitle">Tap the mic, speak your email</p>

      <button
        className={`mic-button ${status === 'recording' ? 'recording' : ''}`}
        onClick={status === 'idle' || status === 'done' ? startRecording : stopRecording}
        disabled={status === 'processing' || status === 'composing'}
      >
        {status === 'idle' && '🎤'}
        {status === 'recording' && '⏹'}
        {status === 'processing' && '⏳'}
        {status === 'composing' && '✍️'}
        {status === 'done' && '🎤'}
      </button>

      <p className="status-text">
        {status === 'idle' && 'Tap to start recording'}
        {status === 'recording' && 'Recording... tap to stop'}
        {status === 'processing' && 'Transcribing your voice...'}
        {status === 'composing' && 'Composing your email...'}
        {status === 'done' && 'Draft ready! Tap mic to refine or start over'}
      </p>

      {transcript && (
        <div className="card">
          <h3>You said:</h3>
          <p>{transcript}</p>
        </div>
      )}

      {emailDraft.subject && (
        <div className="card">
          <h3>Subject:</h3>
          <p>{emailDraft.subject}</p>
        </div>
      )}

      {emailDraft.body && (
        <div className="card">
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '13px', color: '#666', display: 'block', marginBottom: '4px' }}>To (optional):</label>
            <input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="recipient@gmail.com"
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                border: '1px solid #ccc',
                fontSize: '14px',
                fontFamily: 'inherit',
                boxSizing: 'border-box'
              }}
            />
          </div>
          <h3>Email draft:</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{emailDraft.body}</p>

          {showEditBox && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <textarea
                  value={editInstruction}
                  onChange={(e) => setEditInstruction(e.target.value)}
                  placeholder={isEditRecording ? '🔴 Listening...' : isEditTranscribing ? '⏳ Transcribing...' : 'Type or speak your edit instruction...'}
                  style={{
                    flex: 1,
                    minHeight: '80px',
                    padding: '10px',
                    borderRadius: '8px',
                    border: '1px solid #ccc',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    boxSizing: 'border-box'
                  }}
                />
                <button
                  onClick={isEditRecording ? stopEditRecording : startEditRecording}
                  disabled={isEditTranscribing}
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    border: 'none',
                    background: isEditRecording ? '#ef4444' : '#4f46e5',
                    fontSize: '20px',
                    cursor: isEditTranscribing ? 'not-allowed' : 'pointer',
                    flexShrink: 0,
                    animation: isEditRecording ? 'pulse 1.5s infinite' : 'none',
                    opacity: isEditTranscribing ? 0.5 : 1
                  }}
                >
                  {isEditTranscribing ? '⏳' : isEditRecording ? '⏹' : '🎤'}
                </button>
              </div>
              {isEditRecording && (
                <p style={{ fontSize: '13px', color: '#ef4444', marginTop: '6px' }}>
                  Recording... tap ⏹ to stop
                </p>
              )}
              <button onClick={handleTextEdit} disabled={isEditTranscribing || isEditRecording} style={{
                marginTop: '8px',
                padding: '10px 20px',
                background: '#4f46e5',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: (isEditTranscribing || isEditRecording) ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                width: '100%',
                opacity: (isEditTranscribing || isEditRecording) ? 0.5 : 1
              }}>
                {isEditTranscribing ? 'Transcribing...' : 'Apply edit'}
              </button>
            </div>
          )}

          <button onClick={openInGmail} style={{
            width: '100%',
            marginTop: '16px',
            padding: '12px',
            background: '#ea4335',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '15px',
            fontWeight: '500'
          }}>
            ✉️ Open in Gmail
          </button>

          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button onClick={() => setShowEditBox(!showEditBox)} style={{
              flex: 1,
              padding: '10px',
              background: '#4f46e5',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px'
            }}>
              {showEditBox ? 'Cancel edit' : '✏️ Edit draft'}
            </button>
            <button onClick={copyToClipboard} style={{
              flex: 1,
              padding: '10px',
              background: 'transparent',
              border: '1px solid #ccc',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              color: '#666'
            }}>
              📋 Copy
            </button>
            <button onClick={resetDraft} style={{
              flex: 1,
              padding: '10px',
              background: 'transparent',
              border: '1px solid #ccc',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              color: '#666'
            }}>
              🔄 Reset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default App