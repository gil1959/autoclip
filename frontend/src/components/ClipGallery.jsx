// frontend/src/components/ClipGallery.jsx
import React from 'react';

export default function ClipGallery({ clips, activeClipId, onSelectClip, onBurnCaptions }) {
  if (!clips || clips.length === 0) {
    return (
      <div className="glass-panel text-center p-8" style={{ marginTop: '20px' }}>
        <p style={{ color: 'var(--text-secondary)' }}>No clip suggestions generated yet.</p>
      </div>
    );
  }

  const getStatusBadge = (status) => {
    switch (status) {
      case 'RAW':
        return <span className="badge badge-pending">Raw Clip</span>;
      case 'CAPTIONING':
        return <span className="badge badge-processing">✏️ Captioning</span>;
      case 'READY':
        return <span className="badge badge-success">✨ Ready</span>;
      case 'POSTED':
        return <span className="badge badge-success" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-indigo)', borderColor: 'var(--accent-indigo)' }}>📢 Posted</span>;
      default:
        return <span className="badge badge-failed">{status}</span>;
    }
  };

  return (
    <div style={{ marginTop: '20px' }}>
      <h3 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '16px', fontFamily: 'var(--font-display)', textAlign: 'left' }}>
        🎬 Gemini AI Viral Clip Suggestions
      </h3>
      
      <div className="grid grid-cols-3 gap-4">
        {clips.map((clip) => {
          const isActive = activeClipId === clip.id;
          const duration = (clip.endTime - clip.startTime).toFixed(1);
          
          return (
            <div 
              key={clip.id} 
              className={`glass-panel p-6 flex flex-col justify-between`}
              style={{
                border: isActive ? '2px solid var(--accent-purple)' : '1px solid var(--border-light)',
                boxShadow: isActive ? 'var(--shadow-glow)' : 'var(--shadow-premium)',
                transform: isActive ? 'translateY(-2px)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                textAlign: 'left'
              }}
              onClick={() => onSelectClip(clip.id)}
            >
              <div>
                <div className="flex justify-between items-center mb-4">
                  {getStatusBadge(clip.status)}
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    ⏱️ {duration}s
                  </span>
                </div>
                
                <h4 style={{ fontSize: '16px', fontWeight: 700, lineHeight: 1.4, marginBottom: '8px', color: 'var(--text-primary)' }}>
                  {clip.title}
                </h4>
                
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '16px' }}>
                  Segment: <strong style={{ color: 'var(--text-secondary)' }}>{clip.startTime.toFixed(1)}s</strong> to <strong style={{ color: 'var(--text-secondary)' }}>{clip.endTime.toFixed(1)}s</strong>
                </p>
              </div>

              <div className="flex flex-col gap-2" style={{ marginTop: 'auto' }}>
                <button 
                  className={`btn w-full ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '8px 12px', fontSize: '13px' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectClip(clip.id);
                  }}
                >
                  Watch Clip
                </button>

                {clip.status === 'RAW' && (
                  <button 
                    className="btn btn-success w-full"
                    style={{ padding: '8px 12px', fontSize: '13px' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onBurnCaptions(clip.id);
                    }}
                  >
                    🎨 Burn AI Captions
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
