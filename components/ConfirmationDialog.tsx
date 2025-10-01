import React from 'react';

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmButtonClass?: string;
  secondaryActionText?: string;
  onSecondaryAction?: () => void;
  secondaryButtonClass?: string;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ 
    isOpen, 
    onClose, 
    onConfirm, 
    title, 
    children,
    confirmText = 'Delete',
    cancelText = 'Cancel',
    confirmButtonClass = 'bg-red-600 hover:bg-red-500 text-white', // default to danger for existing uses
    secondaryActionText,
    onSecondaryAction,
    secondaryButtonClass = 'bg-neutral-700 dark:bg-neutral-600 hover:bg-neutral-600 dark:hover:bg-neutral-500 text-white'
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div 
        className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 transition-opacity"
        aria-labelledby="modal-title"
        role="dialog"
        aria-modal="true"
        onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl border border-neutral-200 dark:border-neutral-800 w-full max-w-md m-4 transform transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <h3 className="text-lg font-semibold leading-6 text-black dark:text-white" id="modal-title">
            {title}
          </h3>
          <div className="mt-2">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {children}
            </p>
          </div>
        </div>
        <div className="bg-neutral-100 dark:bg-neutral-800/50 px-6 py-3 flex flex-row-reverse items-center gap-3 rounded-b-lg">
            <button
              type="button"
              className={`inline-flex w-full justify-center rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition-colors sm:w-auto ${confirmButtonClass}`}
              onClick={onConfirm}
            >
              {confirmText}
            </button>
            {onSecondaryAction && secondaryActionText && (
               <button
                  type="button"
                  className={`inline-flex w-full justify-center rounded-md px-4 py-2 text-sm font-semibold shadow-sm transition-colors sm:w-auto ${secondaryButtonClass}`}
                  onClick={onSecondaryAction}
               >
                  {secondaryActionText}
               </button>
            )}
            <button
              type="button"
              className="inline-flex w-full justify-center rounded-md bg-neutral-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-neutral-500 dark:bg-neutral-700 dark:hover:bg-neutral-600 sm:w-auto"
              onClick={onClose}
            >
              {cancelText}
            </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(ConfirmationDialog);