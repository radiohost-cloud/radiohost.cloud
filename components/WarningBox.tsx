import React from 'react';
import { ExclamationTriangleIcon } from './icons/ExclamationTriangleIcon';

interface WarningBoxProps {
    children: React.ReactNode;
}

const WarningBox: React.FC<WarningBoxProps> = ({ children }) => {
    return (
        <div className="p-3 mb-4 flex items-start gap-3 bg-yellow-100 dark:bg-yellow-900/50 border border-yellow-300 dark:border-yellow-700 rounded-lg text-sm text-yellow-800 dark:text-yellow-200">
            <div className="flex-shrink-0 pt-0.5">
                <ExclamationTriangleIcon className="w-5 h-5" />
            </div>
            <div>
                {children}
            </div>
        </div>
    );
};

export default WarningBox;
