import { type Track, type User } from '../types';

// This service simulates a backend API for HOST mode.
// In a real application, these fetch calls would hit a running server.
// The provided server.js is an example implementation of this backend.

const handleResponse = async (response: Response) => {
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errorData.message || 'An error occurred');
    }
    return response.json();
};

export const login = (email: string, pass: string): Promise<User> => {
    return fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass }),
    }).then(handleResponse);
};

export const signup = (user: User): Promise<User> => {
    return fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
    }).then(handleResponse);
};

export const getUser = (email: string) => {
    return fetch(`/api/user/${email}`).then(handleResponse);
};

export const getAllUsers = (): Promise<User[]> => {
    return fetch('/api/users').then(handleResponse);
};

export const updateUserRole = (email: string, role: 'studio' | 'presenter'): Promise<User> => {
    return fetch(`/api/user/${email}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
    }).then(handleResponse);
};

export const getUserData = <T>(email: string): Promise<T | null> => {
    return fetch(`/api/userdata/${email}`).then(handleResponse);
};

export const putUserData = (email: string, data: any) => {
    return fetch(`/api/userdata/${email}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }).then(handleResponse);
};

export const uploadTrack = async (file: File, webkitRelativePath?: string): Promise<Track> => {
    const formData = new FormData();
    formData.append('webkitRelativePath', webkitRelativePath || file.name);
    formData.append('audioFile', file);

    const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
    });
    return handleResponse(response);
};

export const deleteTrack = (track: Track) => {
    return fetch(`/api/track/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: track.id }), // id is now the relative path
    }).then(handleResponse);
};

export const createFolder = (folderPath: string) => {
    return fetch('/api/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath }),
    }).then(handleResponse);
};