import React, { useState } from 'react';
import { CloseIcon } from './icons/CloseIcon';
import { InstallPwaIcon } from './icons/InstallPwaIcon';

interface PwaInstallModalProps {
    isOpen: boolean;
    onClose: (dontShowAgain: boolean) => void;
}

const PwaInstallModal: React.FC<PwaInstallModalProps> = ({ isOpen, onClose }) => {
    const [dontShowAgain, setDontShowAgain] = useState(false);

    if (!isOpen) return null;

    const handleClose = () => {
        onClose(dontShowAgain);
    };

    return (
        <div 
            className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 transition-opacity"
            aria-labelledby="modal-title"
            role="dialog"
            aria-modal="true"
            onClick={handleClose}
        >
            <div 
                className="bg-neutral-100 dark:bg-neutral-900 rounded-lg shadow-xl border border-neutral-200 dark:border-neutral-800 w-full max-w-lg m-4 flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex-shrink-0 flex justify-between items-center p-4 border-b border-neutral-200 dark:border-neutral-800">
                    <h2 id="modal-title" className="text-2xl font-bold text-black dark:text-white">Install as a Desktop App</h2>
                    <button onClick={handleClose} className="p-1 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800">
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex-grow p-6 text-neutral-700 dark:text-neutral-300 text-base leading-relaxed space-y-4">
                    <p>For the best experience, install RadioHost.cloud as a desktop application. This gives you a dedicated window, a desktop icon, and offline access.</p>
                    
                    <h3 className="text-xl font-semibold text-black dark:text-white pt-2">How to Install on Chrome:</h3>
                    
                    <ol className="list-decimal list-outside space-y-4 pl-6">
                        <li>
                            Look for the <strong>Install icon</strong> in your Chrome address bar (at the top right of the browser). It looks like this:
                            <div className="flex items-center gap-2 mt-2 p-2 bg-neutral-200 dark:bg-neutral-800 rounded-md">
                                <InstallPwaIcon className="w-6 h-6 text-black dark:text-white" />
                                <span className="font-mono text-sm">Install RadioHost.cloud</span>
                            </div>
                        </li>
                        <li>Click the icon.</li>
                        <li>A prompt will appear. Click <strong>"Install"</strong> to confirm.</li>
                    </ol>

                    <p className="pt-2">That's it! The app will open in its own window and an icon will be added to your desktop or applications folder.</p>
                </div>

                <div className="flex-shrink-0 bg-neutral-200/50 dark:bg-neutral-800/50 px-6 py-3 flex items-center justify-between rounded-b-lg">
                    <div className="flex items-center gap-2">
                         <input
                            id="dont-show-again"
                            type="checkbox"
                            checked={dontShowAgain}
                            onChange={(e) => setDontShowAgain(e.target.checked)}
                            className="h-4 w-4 rounded border-neutral-400 dark:border-neutral-600 bg-white dark:bg-black text-black dark:text-white focus:ring-black dark:focus:ring-white"
                        />
                        <label htmlFor="dont-show-again" className="text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer">
                            Don't show this again
                        </label>
                    </div>
                    <button
                      type="button"
                      className="inline-flex justify-center rounded-md bg-black dark:bg-white px-4 py-2 text-sm font-semibold text-white dark:text-black shadow-sm hover:bg-neutral-800 dark:hover:bg-neutral-200"
                      onClick={handleClose}
                    >
                      Got it, thanks!
                    </button>
                </div>
            </div>
        </div>
    );
};

export default React.memo(PwaInstallModal);