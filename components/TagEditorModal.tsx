import React, { useState, useEffect, useRef } from 'react';
import { type Track, type Folder, type LibraryItem } from '../types';
import { CloseIcon } from './icons/CloseIcon';

// FIX: Changed props to accept an array of 'items' and specific save handlers for tracks and folders.
interface TagEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    items: LibraryItem[];
    allTags: string[];
    onSaveFolderTags: (folderId: string, tags: string[]) => void;
    onSaveTrackTags: (itemIds: string[], tags: string[]) => void;
}

// FIX: Updated component signature and logic to handle multiple items.
const TagEditorModal: React.FC<TagEditorModalProps> = ({ isOpen, onClose, items, allTags, onSaveFolderTags, onSaveTrackTags }) => {
    const [tags, setTags] = useState<string[]>([]);
    const [inputValue, setInputValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen && items.length > 0) {
            // Find common tags among all selected items
            const allTagsSets = items.map(item => new Set(item.tags || []));
            const commonTags = allTagsSets.reduce((acc, currentSet) => {
                return new Set([...acc].filter(tag => currentSet.has(tag)));
            }, allTagsSets[0] || new Set<string>());
            
            setTags(Array.from(commonTags));
            setInputValue('');
        }
    }, [isOpen, items]);

    const handleAddTag = (tagToAdd: string) => {
        const trimmedTag = tagToAdd.trim();
        if (trimmedTag && !tags.includes(trimmedTag)) {
            setTags(prevTags => [...prevTags, trimmedTag]);
        }
        setInputValue('');
    };
    
    const handleRemoveTag = (tagToRemove: string) => {
        setTags(prevTags => prevTags.filter(t => t !== tagToRemove));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            handleAddTag(inputValue);
        }
    };

    const handleSave = () => {
        let finalTags = [...tags];
        const trimmedInput = inputValue.trim();
        if (trimmedInput && !finalTags.includes(trimmedInput)) {
            finalTags.push(trimmedInput);
        }
        
        const trackIds = items.filter(i => i.type !== 'folder').map(i => i.id);
        const folders = items.filter(i => i.type === 'folder') as Folder[];

        if (trackIds.length > 0) {
            onSaveTrackTags(trackIds, finalTags);
        }
        for (const folder of folders) {
            onSaveFolderTags(folder.id, finalTags);
        }
        onClose();
    };

    if (!isOpen || items.length === 0) return null;

    const filteredSuggestions = allTags.filter(
        tag => tag.toLowerCase().includes(inputValue.toLowerCase()) && !tags.includes(tag)
    );

    const titleText = items.length === 1 
        ? `"${'name' in items[0] ? items[0].name : items[0].title}"`
        : `${items.length} items`;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg shadow-xl border border-neutral-300 dark:border-neutral-800 w-full max-w-md m-4 flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 className="text-lg font-semibold text-black dark:text-white">Edit Tags for {titleText}</h3>
                    {items.some(i => i.type === 'folder') && (
                        <p className="mt-2 text-sm text-yellow-600 dark:text-yellow-400 p-2 bg-yellow-400/10 rounded-md border border-yellow-500/20">
                            <strong>Note:</strong> Tag changes will be applied to all tracks and subfolders within any selected folders.
                        </p>
                    )}
                    <div className="mt-4">
                        <div className="w-full bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md p-2 flex flex-wrap gap-2 items-center" onClick={() => inputRef.current?.focus()}>
                            {tags.map(tag => (
                                <span key={tag} className="flex items-center gap-1 bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 text-sm font-medium px-2 py-1 rounded-full">
                                    {tag}
                                    <button onClick={() => handleRemoveTag(tag)} className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-400">
                                        <CloseIcon className="w-3 h-3"/>
                                    </button>
                                </span>
                            ))}
                            <input
                                ref={inputRef}
                                type="text"
                                value={inputValue}
                                onChange={e => setInputValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Add a tag..."
                                list="tag-suggestions"
                                className="flex-grow bg-transparent outline-none text-sm text-black dark:text-white"
                            />
                            <datalist id="tag-suggestions">
                                {filteredSuggestions.map(tag => (
                                    <option key={tag} value={tag} />
                                ))}
                            </datalist>
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

export default React.memo(TagEditorModal);
