import React from 'react';
import { CloseIcon } from './icons/CloseIcon';

interface ArtworkModalProps {
  isOpen: boolean;
  artworkUrl: string | null;
  onClose: () => void;
}

const ArtworkModal: React.FC<ArtworkModalProps> = ({ isOpen, artworkUrl, onClose }) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 transition-opacity duration-300 ease-in-out animate-fade-in"
      onClick={onClose}
      aria-labelledby="artwork-modal-title"
      role="dialog"
      aria-modal="true"
    >
      <style>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-in-out;
        }
        @keyframes zoom-in {
            from { transform: scale(0.9); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }
        .animate-zoom-in {
            animation: zoom-in 0.3s ease-in-out;
        }
      `}</style>
      <div
        className="relative p-4 animate-zoom-in"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 p-2 bg-white/20 dark:bg-black/20 rounded-full text-white hover:bg-white/40 dark:hover:bg-black/40 transition-colors"
          aria-label="Close artwork view"
        >
          <CloseIcon className="w-6 h-6" />
        </button>
        {artworkUrl && (
          <img
            src={artworkUrl}
            alt="Enlarged album artwork"
            className="max-w-[80vw] max-h-[80vh] object-contain rounded-lg shadow-2xl"
          />
        )}
      </div>
    </div>
  );
};

export default React.memo(ArtworkModal);
