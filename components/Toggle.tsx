import React from 'react';

export const Toggle: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; id: string; disabled?: boolean; }> = ({ checked, onChange, id, disabled = false }) => (
    <button
        type="button"
        className={`${
            checked ? 'bg-green-600' : 'bg-neutral-300 dark:bg-neutral-700'
        } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-neutral-100 dark:focus:ring-offset-neutral-900 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        id={id}
        disabled={disabled}
    >
        <span
            aria-hidden="true"
            className={`${
                checked ? 'translate-x-5' : 'translate-x-0'
            } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
        />
    </button>
);