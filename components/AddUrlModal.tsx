import React, { useState } from 'react';
import { type Track, TrackType } from '../types';

interface AddUrlModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddTrack: (track: Track) => void;
}

const getAudioDurationFromUrl = (url: string): Promise<number> => {
    return new Promise((resolve, reject) => {
        const audio = document.createElement('audio');
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => {
            window.URL.revokeObjectURL(audio.src);
            resolve(audio.duration);
        };
        audio.onerror = (e) => {
            console.error(e);
            reject(`Could not load audio metadata from this URL. Make sure the link is a direct link to an audio file and that the server allows requests (CORS).`);
        };
        // Use a proxy if necessary, but for simplicity, we'll try a direct fetch.
        // For many public URLs this will fail due to CORS. A server-side component would be more robust.
        audio.src = url; 
    });
};

const AddUrlModal: React.FC<AddUrlModalProps> = ({ isOpen, onClose, onAddTrack }) => {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !title) {
        setError('URL and Title are required.');
        return;
    }
    setError(null);
    setIsLoading(true);
    
    try {
        const duration = await getAudioDurationFromUrl(url);
        const newTrack: Track = {
            id: `url-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            title,
            artist: artist || 'Unknown Artist',
            duration,
            type: TrackType.URL,
            src: url,
        };
        onAddTrack(newTrack);
        handleClose();
    } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred.');
    } finally {
        setIsLoading(false);
    }
  };

  const handleClose = () => {
    setUrl('');
    setTitle('');
    setArtist('');
    setError(null);
    setIsLoading(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={handleClose}>
      <div className="bg-neutral-900 rounded-lg shadow-xl border border-neutral-800 w-full max-w-md m-4" onClick={e => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            <h3 className="text-lg font-semibold text-white">Insert URL</h3>
            <div>
              <label htmlFor="track-url" className="block text-sm font-medium text-neutral-300">Track URL</label>
              <input type="url" id="track-url" value={url} onChange={e => setUrl(e.target.value)} required placeholder="https://..."
                className="mt-1 w-full bg-black border border-neutral-700 rounded-md px-3 py-2 text-white" />
            </div>
            <div>
              <label htmlFor="track-title" className="block text-sm font-medium text-neutral-300">Title</label>
              <input type="text" id="track-title" value={title} onChange={e => setTitle(e.target.value)} required
                className="mt-1 w-full bg-black border border-neutral-700 rounded-md px-3 py-2 text-white" />
            </div>
            <div>
              <label htmlFor="track-artist" className="block text-sm font-medium text-neutral-300">Artist</label>
              <input type="text" id="track-artist" value={artist} onChange={e => setArtist(e.target.value)}
                className="mt-1 w-full bg-black border border-neutral-700 rounded-md px-3 py-2 text-white" />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
          </div>
          <div className="bg-neutral-800/50 px-6 py-3 flex flex-row-reverse gap-3 rounded-b-lg">
            <button type="submit" disabled={isLoading}
              className="inline-flex justify-center rounded-md bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-neutral-200 disabled:bg-neutral-700">
              {isLoading ? 'Fetching...' : 'Add Track'}
            </button>
            <button type="button" onClick={handleClose}
              className="inline-flex justify-center rounded-md bg-neutral-700 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-600">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default React.memo(AddUrlModal);