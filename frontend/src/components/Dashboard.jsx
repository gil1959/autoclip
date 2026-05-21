// frontend/src/components/Dashboard.jsx
import React, { useState, useEffect } from 'react';
import Uploader from './Uploader.jsx';
import ClipGallery from './ClipGallery.jsx';
import ClipPlayer from './ClipPlayer.jsx';

export default function Dashboard({ token }) {
  const [activeJobId, setActiveJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [jobError, setJobError] = useState('');
  
  const [clips, setClips] = useState([]);
  const [activeClipId, setActiveClipId] = useState(null);
  const [polling, setPolling] = useState(false);

  // Poll active video job
  useEffect(() => {
    if (!activeJobId) return;

    let intervalId;
    const checkStatus = async () => {
      try {
        const response = await fetch(`http://localhost:3000/api/upload/status/${activeJobId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (!response.ok) {
          throw new Error('Failed to retrieve job status.');
        }

        const data = await response.json();
        setJobStatus(data.status);
        
        if (data.status === 'COMPLETED') {
          clearInterval(intervalId);
          setPolling(false);
          fetchClips(activeJobId);
        } else if (data.status === 'FAILED') {
          clearInterval(intervalId);
          setPolling(false);
          setJobError(data.errorMessage || 'AI Clipping processor encountered an unhandled error.');
        }
      } catch (err) {
        clearInterval(intervalId);
        setPolling(false);
        setJobError(err.message);
      }
    };

    setPolling(true);
    setJobError('');
    checkStatus(); // Initial check
    
    intervalId = setInterval(checkStatus, 4000); // Check every 4 seconds

    return () => {
      clearInterval(intervalId);
      setPolling(false);
    };
  }, [activeJobId, token]);

  const fetchClips = async (jobId) => {
    try {
      const response = await fetch(`http://localhost:3000/api/clips?jobId=${jobId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to load clip details.');
      
      const data = await response.json();
      setClips(data.clips || []);
      
      if (data.clips && data.clips.length > 0) {
        setActiveClipId(data.clips[0].id);
      }
    } catch (err) {
      setJobError(err.message);
    }
  };

  const handleUploadSuccess = (jobId) => {
    setActiveJobId(jobId);
    setJobStatus('PENDING');
    setClips([]);
    setActiveClipId(null);
  };

  const handleBurnCaptions = async (clipId) => {
    // Set clip status to CAPTIONING locally
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: 'CAPTIONING' } : c));
    
    try {
      const response = await fetch(`http://localhost:3000/api/clips/${clipId}/caption`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to start captioning worker.');
      }

      // Start polling status of this specific clip
      pollClipStatus(clipId);
    } catch (err) {
      alert(`Captioning error: ${err.message}`);
      setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: 'RAW' } : c));
    }
  };

  const pollClipStatus = async (clipId) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 30) { // Limit polling to 2 mins
        clearInterval(interval);
        return;
      }

      try {
        const response = await fetch(`http://localhost:3000/api/clips/${clipId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          const clip = data.clip;
          
          if (clip.status === 'READY' || clip.status === 'POSTED') {
            clearInterval(interval);
            // Update local clips array
            setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: clip.status, finalVideoKey: clip.finalVideoKey, finalVideoUrl: clip.finalVideoUrl } : c));
          }
        }
      } catch {
        // Non-critical poll failure
      }
    }, 4000);
  };

  const activeClip = clips.find(c => c.id === activeClipId);

  return (
    <div className="w-full flex flex-col" style={{ gap: '24px' }}>
      
      {/* Dynamic Uploader Workspace */}
      {!activeJobId && (
        <Uploader token={token} onUploadSuccess={handleUploadSuccess} />
      )}

      {/* Queue Processing Panel */}
      {activeJobId && (jobStatus === 'PENDING' || jobStatus === 'PROCESSING') && (
        <div className="glass-panel text-center flex flex-col items-center" style={{ padding: '60px 40px', minHeight: '300px' }}>
          <div className="spin" style={{ fontSize: '56px', marginBottom: '24px', display: 'inline-block' }}>⚙️</div>
          <h2 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '12px', fontFamily: 'var(--font-display)' }}>
            Processing Viral Moments...
          </h2>
          <div className="badge badge-processing" style={{ padding: '6px 16px', fontSize: '12px', marginBottom: '20px' }}>
            Queue Status: {jobStatus}
          </div>
          
          <p style={{ color: 'var(--text-secondary)', fontSize: '15px', maxWidth: '420px', marginBottom: '24px' }}>
            {jobStatus === 'PENDING' 
              ? 'Your video is queued. Waiting for an active worker node...' 
              : 'Google Gemini 1.5 Pro is analyzing your content. Extracting audio and identifying the hooks...'}
          </p>

          <div style={{ width: '200px', height: '4px', background: 'var(--bg-primary)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              width: '40%',
              height: '100%',
              background: 'var(--accent-purple)',
              borderRadius: '2px',
              animation: 'pulse-slow 1.5s infinite ease-in-out'
            }} />
          </div>
        </div>
      )}

      {/* Failure Screen */}
      {jobError && (
        <div className="glass-panel p-8 text-center flex flex-col items-center" style={{ borderColor: '#f03e3e', background: 'rgba(240, 62, 62, 0.05)' }}>
          <span style={{ fontSize: '48px', marginBottom: '16px' }}>❌</span>
          <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px', color: '#f03e3e' }}>
            Video Processing Failed
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '480px', marginBottom: '24px' }}>
            {jobError}
          </p>
          <button 
            className="btn btn-secondary" 
            onClick={() => {
              setActiveJobId(null);
              setJobStatus(null);
              setJobError('');
            }}
          >
            Reset Workspace & Try Again
          </button>
        </div>
      )}

      {/* Completed State: Suggestions & Editor */}
      {jobStatus === 'COMPLETED' && clips.length > 0 && (
        <div className="flex flex-col gap-8">
          
          {/* Dashboard Back Control */}
          <div className="flex justify-between items-center w-full">
            <button 
              className="btn btn-secondary"
              style={{ padding: '8px 16px', fontSize: '13px' }}
              onClick={() => {
                setActiveJobId(null);
                setJobStatus(null);
                setClips([]);
                setActiveClipId(null);
              }}
            >
              ← Upload a New Video
            </button>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Job Ref: <code style={{ fontSize: '12px' }}>{activeJobId}</code>
            </div>
          </div>

          <ClipGallery 
            clips={clips} 
            activeClipId={activeClipId} 
            onSelectClip={setActiveClipId}
            onBurnCaptions={handleBurnCaptions}
          />

          {activeClip && (
            <ClipPlayer 
              clip={activeClip} 
              token={token} 
              onPostSuccess={(clipId) => {
                setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: 'POSTED' } : c));
              }}
            />
          )}

        </div>
      )}

    </div>
  );
}
