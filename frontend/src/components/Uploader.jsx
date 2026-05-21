// frontend/src/components/Uploader.jsx
import React, { useState, useRef } from 'react';

export default function Uploader({ token, onUploadSuccess }) {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      validateAndUpload(file);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      validateAndUpload(file);
    }
  };

  const triggerInput = () => {
    fileInputRef.current.click();
  };

  const validateAndUpload = (file) => {
    setError('');
    
    // Check mime type
    const allowedTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska'];
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(mp4|mov|webm|avi|mkv)$/i)) {
      setError('Unsupported video format. Please upload MP4, MOV, WebM, AVI, or MKV.');
      return;
    }

    // Check size limit (e.g. 500MB for local test, backend supports 2GB)
    if (file.size > 500 * 1024 * 1024) {
      setError('File is too large. Local sandbox upload is limited to 500 MB.');
      return;
    }

    uploadFile(file);
  };

  const uploadFile = (file) => {
    setUploading(true);
    setProgress(0);

    const formData = new FormData();
    formData.append('video', file);

    const xhr = new XMLHttpRequest();
    
    // Monitor upload progress
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percentage = Math.round((e.loaded / e.total) * 100);
        setProgress(percentage);
      }
    });

    xhr.addEventListener('load', () => {
      setUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          if (res.success && res.videoJobId) {
            onUploadSuccess(res.videoJobId);
          } else {
            setError(res.error || 'Failed to process video upload');
          }
        } catch {
          setError('Failed to parse upload server response.');
        }
      } else {
        try {
          const res = JSON.parse(xhr.responseText);
          setError(res.error || `Upload failed with status ${xhr.status}`);
        } catch {
          setError(`Upload failed with status ${xhr.status}`);
        }
      }
    });

    xhr.addEventListener('error', () => {
      setUploading(false);
      setError('Network connection error. Ensure backend is running.');
    });

    xhr.open('POST', 'http://localhost:3000/api/upload');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  };

  return (
    <div className="w-full" style={{ marginBottom: '32px' }}>
      <div 
        className="glass-panel text-center flex flex-col justify-center items-center"
        style={{
          minHeight: '260px',
          border: dragActive ? '2px dashed var(--accent-purple)' : '2px dashed var(--border-light)',
          borderRadius: '16px',
          padding: '40px 20px',
          background: dragActive ? 'rgba(168, 85, 247, 0.05)' : 'rgba(18, 16, 38, 0.4)',
          cursor: uploading ? 'not-allowed' : 'pointer',
          position: 'relative',
          transition: 'all 0.25s ease'
        }}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={uploading ? null : triggerInput}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleChange}
          disabled={uploading}
          accept="video/*"
        />

        {uploading ? (
          <div className="flex flex-col items-center w-full" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
            <span className="spin" style={{ fontSize: '48px', marginBottom: '16px', display: 'block' }}>⚡</span>
            <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
              Streaming to Storage Node ({progress}%)
            </h3>
            
            {/* Progress bar */}
            <div className="w-full" style={{ height: '8px', background: 'var(--bg-primary)', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border-light)', marginBottom: '16px' }}>
              <div 
                style={{ 
                  width: `${progress}%`, 
                  height: '100%', 
                  background: 'linear-gradient(90deg, var(--accent-indigo) 0%, var(--accent-purple) 100%)',
                  borderRadius: '4px',
                  boxShadow: '0 0 8px var(--accent-purple)',
                  transition: 'width 0.1s linear'
                }} 
              />
            </div>
            
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
              Do not close this tab. Processing will trigger automatically once completed.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div 
              className="bg-gradient-cyber flex items-center justify-center" 
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                marginBottom: '20px',
                boxShadow: 'var(--shadow-glow)'
              }}
            >
              <span style={{ fontSize: '28px', color: '#fff' }}>📤</span>
            </div>
            
            <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px', fontFamily: 'var(--font-display)' }}>
              Drag & Drop Your Video
            </h3>
            
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', marginBottom: '16px', maxWidth: '360px' }}>
              Upload any long-form video or podcast. Gemini AI will identify the top 3 high-impact viral moments.
            </p>
            
            <button className="btn btn-secondary" style={{ pointerEvents: 'none' }}>
              Select Local File
            </button>
            
            <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '16px' }}>
              Supports MP4, MOV, WebM (up to 500 MB)
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="badge-failed w-full text-center" style={{ marginTop: '16px', padding: '12px', borderRadius: '8px', fontSize: '13px', textTransform: 'none', display: 'block' }}>
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}
