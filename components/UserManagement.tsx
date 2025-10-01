import React from 'react';
import { type User } from '../types';
import * as dataService from '../services/dataService';
import { UsersIcon } from './icons/UsersIcon';

interface UserManagementProps {
    users: User[];
    onUsersUpdate: (users: User[]) => void;
    currentUser: User | null;
}

const UserManagement: React.FC<UserManagementProps> = ({ users, onUsersUpdate, currentUser }) => {

    const handleRoleChange = async (email: string, newRole: 'studio' | 'presenter') => {
        try {
            const updatedUser = await dataService.updateUserRole(email, newRole);
            const newUsers = users.map(u => u.email === email ? updatedUser : u);
            onUsersUpdate(newUsers);
        } catch(error) {
            console.error("Failed to update user role:", error);
            alert("Could not update user role. Please try again.");
        }
    };

    return (
        <div className="p-4 h-full flex flex-col">
            <div className="flex-shrink-0 pb-4 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-black dark:text-white flex items-center gap-2">
                    <UsersIcon className="w-6 h-6" />
                    User Management
                </h3>
            </div>
            <div className="flex-grow overflow-y-auto pr-2 space-y-2">
                {users.length > 0 ? (
                    users.map(user => (
                        <div key={user.email} className="p-3 rounded-lg bg-neutral-200 dark:bg-neutral-800 flex items-center justify-between gap-4">
                            <div className="flex-grow overflow-hidden">
                                <p className="font-semibold text-black dark:text-white truncate">{user.nickname}</p>
                                <p className="text-sm text-neutral-600 dark:text-neutral-400 truncate">{user.email}</p>
                            </div>
                            <div className="flex-shrink-0 flex items-center gap-4">
                                <div>
                                    <label htmlFor={`role-${user.email}`} className="sr-only">Role for {user.nickname}</label>
                                    <select
                                        id={`role-${user.email}`}
                                        value={user.role}
                                        onChange={(e) => handleRoleChange(user.email, e.target.value as 'studio' | 'presenter')}
                                        disabled={user.email === currentUser?.email}
                                        className="bg-white dark:bg-black border border-neutral-300 dark:border-neutral-700 rounded-md px-2 py-1 text-sm disabled:opacity-50"
                                    >
                                        <option value="studio">Studio</option>
                                        <option value="presenter">Presenter</option>
                                    </select>
                                </div>
                                <button
                                    disabled
                                    className="px-3 py-1 text-sm font-semibold rounded-md bg-neutral-300 dark:bg-neutral-700 text-neutral-500 cursor-not-allowed"
                                    title="Time slot management coming soon"
                                >
                                    Edit Schedule
                                </button>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="h-full flex items-center justify-center text-center text-neutral-500">
                        <p>No other users found.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(UserManagement);
