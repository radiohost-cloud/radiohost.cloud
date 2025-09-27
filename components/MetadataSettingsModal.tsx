
import React, { useState, useEffect } from 'react';
import { type Folder } from '../types';

interface MetadataSettingsModalProps {
  folder: Folder | null;
  onClose: () => void;
  onSave: (folderId: string, settings: { enabled: boolean; customText: string; suppressDuplicateWarning: boolean }) => void;
}

const MetadataSettingsModal: React.FC<MetadataSettingsModalProps> = ({ folder, onClose, onSave }) => {
  const [enabled, setEnabled] = useState(false);
  const [customText, setCustomText] = useState('');
  const [suppressWarning, setSuppressWarning] = useState(false);

  useEffect(() => {
    if (folder) {
      setEnabled(folder.suppressMetadata?.enabled || false);
      setCustomText(folder.suppressMetadata?.customText || '');
      setSuppressWarning(folder.suppressMetadata?.suppressDuplicateWarning || false);
    }
  }, [folder]);

  const handleSave = () => {
    if (folder) {
      onSave(folder.id, { enabled, customText: customText.trim(), suppressDuplicateWarning: suppressWarning });
      onClose();
    }
  };

  if (!folder) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg shadow-xl border border-neutral-300 dark:border-neutral-800 w-full max-w-md m-4 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-black dark:text-white">
            Metadata Settings for "{folder.name}"
          </h3>
          <div className="mt-4 space-y-4">
            <div className="flex items-start gap-3">
               <input
                    id="suppress-enabled"
                    type="checkbox"
                    className="h-5 w-5 rounded mt-0.5 border-neutral-400 dark:border-neutral-600 bg-white dark:bg-black text-black dark:text-white focus:ring-black dark:focus:ring-white"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                />
              <div>
                <label htmlFor="suppress-enabled" className="font-medium text-black dark:text-white cursor-pointer">
                  Suppress metadata for this folder and its contents
                </label>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  When enabled, tracks from this folder will not show their artist/title.
                </p>
              </div>
            </div>
            {enabled && (
              <div>
                <label htmlFor="custom-text" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Custom Display Text
                </label>
                <input
                  id="custom-text"
                  type="text"
                  value={customText}
                  onChange={e => setCustomText(e.target.value)}
                  placeholder="e.g., Your Station Name"
                  className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-3 py-2 text-black dark:text-white"
                />
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                  This text will be displayed and exported instead of artist/title. Leave blank for a default value.
                </p>
              </div>
            )}
             <div className="flex items-start gap-3 pt-4 border-t border-neutral-200 dark:border-neutral-800">
               <input
                    id="suppress-warning"
                    type="checkbox"
                    className="h-5 w-5 rounded mt-0.5 border-neutral-400 dark:border-neutral-600 bg-white dark:bg-black text-black dark:text-white focus:ring-black dark:focus:ring-white"
                    checked={suppressWarning}
                    onChange={(e) => setSuppressWarning(e.target.checked)}
                />
              <div>
                <label htmlFor="suppress-warning" className="font-medium text-black dark:text-white cursor-pointer">
                  Ignore duplicate warnings for this folder
                </label>
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  Useful for folders containing jingles, ads, or other short items that can be played close together.
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-neutral-200/50 dark:bg-neutral-800/50 px-6 py-3 flex flex-row-reverse items-center gap-3 rounded-b-lg">
          <button
            type="button"
            className="inline-flex justify-center rounded-md bg-black text-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200 sm:w-auto"
            onClick={handleSave}
          >
            Save
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

export default React.memo(MetadataSettingsModal);