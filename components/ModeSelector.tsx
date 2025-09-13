import React from 'react';
import { LogoIcon } from './icons/LogoIcon';
import { ServerIcon } from './icons/ServerIcon';
import { DesktopIcon } from './icons/DesktopIcon';

interface ModeSelectorProps {
    onModeSelect: (mode: 'HOST' | 'DEMO') => void;
}

const ModeSelector: React.FC<ModeSelectorProps> = ({ onModeSelect }) => {
    return (
        <div className="fixed inset-0 bg-white dark:bg-black flex flex-col items-center justify-center z-50 p-4">
            <div className="text-center mb-12">
                <LogoIcon className="h-16 w-auto text-black dark:text-white inline-block" />
                <p className="mt-4 text-lg text-neutral-600 dark:text-neutral-400">
                    AI-Powered Radio Automation
                </p>
            </div>
            
            <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* HOST Mode */}
                <div 
                    onClick={() => onModeSelect('HOST')}
                    className="p-8 bg-neutral-100 dark:bg-neutral-900 rounded-xl shadow-lg border-2 border-transparent hover:border-blue-500 cursor-pointer transition-all duration-300 ease-in-out transform hover:-translate-y-1"
                >
                    <div className="flex flex-col items-center text-center">
                        <ServerIcon className="w-16 h-16 mb-4 text-blue-500"/>
                        <h2 className="text-2xl font-bold text-black dark:text-white mb-2">HOST Mode</h2>
                        <p className="text-neutral-600 dark:text-neutral-400">
                            Connect to a remote server. Ideal for multi-user collaboration with a shared media library. Requires a running backend server.
                        </p>
                    </div>
                </div>
                
                {/* DEMO Mode */}
                <div
                    onClick={() => onModeSelect('DEMO')}
                    className="p-8 bg-neutral-100 dark:bg-neutral-900 rounded-xl shadow-lg border-2 border-transparent hover:border-green-500 cursor-pointer transition-all duration-300 ease-in-out transform hover:-translate-y-1"
                >
                    <div className="flex flex-col items-center text-center">
                        <DesktopIcon className="w-16 h-16 mb-4 text-green-500"/>
                        <h2 className="text-2xl font-bold text-black dark:text-white mb-2">DEMO Mode</h2>
                        <p className="text-neutral-600 dark:text-neutral-400">
                            Run the application locally in your browser. All data and media are stored on your device. Perfect for single-user PWA use.
                        </p>
                    </div>
                </div>
            </div>

            <div className="absolute bottom-4 text-center text-xs text-neutral-500">
                <p>Choose 'HOST' for server deployment or 'DEMO' for a local PWA experience.</p>
                <a href="https://github.com/radiohost-cloud/radiohost.cloud" target="_blank" rel="noopener noreferrer" className="underline hover:text-black dark:hover:text-white">Learn More</a>
            </div>
        </div>
    );
};

export default ModeSelector;
