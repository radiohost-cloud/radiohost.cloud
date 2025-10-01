import React from 'react';
import { CloseIcon } from './icons/CloseIcon';
import { SparklesIcon } from './icons/SparklesIcon';
import { MicrophoneIcon } from './icons/MicrophoneIcon';
import { UsersIcon } from './icons/UsersIcon';
import { CalendarIcon } from './icons/CalendarIcon';

interface WhatsNewPopupProps {
    isOpen: boolean;
    onClose: () => void;
}

const WhatsNewPopup: React.FC<WhatsNewPopupProps> = ({ isOpen, onClose }) => {
    return (
        <div
            className={`fixed top-28 right-4 z-50 w-full max-w-sm transition-all duration-500 ease-in-out ${
                isOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'
            }`}
            role="alert"
            aria-live="polite"
        >
            <div className="bg-white dark:bg-neutral-800 rounded-lg shadow-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
                <div className="p-4 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900/50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <SparklesIcon className="w-6 h-6 text-yellow-500" />
                            <h3 className="text-lg font-bold text-black dark:text-white">What's New!</h3>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1 rounded-full text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                            aria-label="Close notification"
                        >
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="p-4 space-y-4">
                    <p className="text-sm text-neutral-700 dark:text-neutral-300">
                        Check out the latest features to enhance your broadcasting experience:
                    </p>
                    <ul className="space-y-3">
                         <li className="flex items-start gap-3">
                            <div className="flex-shrink-0 mt-1 p-1.5 bg-purple-100 dark:bg-purple-900/50 rounded-full">
                                <CalendarIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-black dark:text-white">Broadcast Scheduler</h4>
                                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                                    Plan your shows in advance! Use the new "Scheduler" tab to create playlists that will be prompted to load at their scheduled time.
                                </p>
                            </div>
                        </li>
                        <li className="flex items-start gap-3">
                            <div className="flex-shrink-0 mt-1 p-1.5 bg-blue-100 dark:bg-blue-900/50 rounded-full">
                                <MicrophoneIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-black dark:text-white">Voice Track Editor</h4>
                                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                                    Record and mix your voice-overs directly in the timeline for seamless transitions. Activate "VT Mode" in the playlist to start.
                                </p>
                            </div>
                        </li>
                         <li className="flex items-start gap-3">
                            <div className="flex-shrink-0 mt-1 p-1.5 bg-green-100 dark:bg-green-900/50 rounded-full">
                                <UsersIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
                            </div>
                            <div>
                                <h4 className="font-semibold text-black dark:text-white">Remote Presenter Connection</h4>
                                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                                    Invite co-hosts to join your show from anywhere. Their audio streams directly into a dedicated mixer channel in the studio.
                                </p>
                            </div>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default React.memo(WhatsNewPopup);