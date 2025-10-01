import React, { useState, useEffect } from 'react';
import { type Track, TrackType } from '../types';
import { fetchArtwork } from '../services/artworkService';

interface TrackMetadataModalProps {
  track: Track | null;
  onClose: () => void;
  onSave: (trackId: string, newMetadata: { title: string; artist: string; type: TrackType; remoteArtworkUrl?: string; }) => void;
}

const TrackMetadataModal: React.FC<TrackMetadataModalProps> = ({ track, onClose, onSave }) => {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [type, setType] = useState<TrackType>(TrackType.SONG);

  useEffect(() => {
    if (track) {
      setTitle(track.title || '');
      setArtist(track.artist || '');
      setType(track.type || TrackType.SONG);
    }
  }, [track]);

  const handleSave = async () => {
    if (track) {
      const trimmedTitle = title.trim();
      const trimmedArtist = artist.trim();
      const newRemoteArtworkUrl = await fetchArtwork(trimmedArtist, trimmedTitle);
      onSave(track.id, { 
        title: trimmedTitle, 
        artist: trimmedArtist, 
        type, 
        remoteArtworkUrl: newRemoteArtworkUrl ?? undefined 
      });
      onClose();
    }
  };

  if (!track) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg shadow-xl border border-neutral-300 dark:border-neutral-800 w-full max-w-md m-4 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-black dark:text-white">
            Edit Metadata
          </h3>
          <div className="mt-4 space-y-4">
            <div>
              <label htmlFor="track-title" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Title
              </label>
              <input
                id="track-title"
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-black dark:text-white"
              />
            </div>
             <div>
              <label htmlFor="track-artist" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Artist
              </label>
              <input
                id="track-artist"
                type="text"
                value={artist}
                onChange={e => setArtist(e.target.value)}
                className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-black dark:text-white"
              />
            </div>
             <div>
              <label htmlFor="track-type" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                Type
              </label>
               <select
                  id="track-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as TrackType)}
                  className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-black dark:text-white"
                >
                  {Object.values(TrackType).filter(t => t !== TrackType.URL && t !== TrackType.LOCAL_FILE).map(trackType => (
                    <option key={trackType} value={trackType}>{trackType}</option>
                  ))}
                </select>
            </div>
          </div>
        </div>
        <div className="bg-neutral-200/50 dark:bg-neutral-800/50 px-6 py-3 flex flex-row-reverse items-center gap-3 rounded-b-lg">
          <button
            type="button"
            className="inline-flex justify-center rounded-md bg-black text-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 sm:w-auto"
            onClick={handleSave}
          >
            Save Changes
          </button>
          <button
            type="button"
            className="inline-flex justify-center rounded-md bg-neutral-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-neutral-500 dark:bg-neutral-700 dark:hover:bg-neutral-600 sm:w-auto"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(TrackMetadataModal);