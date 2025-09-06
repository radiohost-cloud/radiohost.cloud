import { type Track } from '../types';

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

export const login = (email: string, pass: string) => {
    return fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass }),
    }).then(handleResponse);
};

export const signup = (user: { email: string; password?: string; nickname: string; }) => {
    return fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
    }).then(handleResponse);
};

export const getUser = (email: string) => {
    return fetch(`/api/user/${email}`).then(handleResponse);
};

export const getAllUsers = () => {
    return fetch('/api/users').then(handleResponse);
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

// Functions for the shared data (library, playlist, etc.)
export const getSharedData = <T>(): Promise<T | null> => {
    return fetch(`/api/shared`).then(handleResponse);
};

export const putSharedData = (data: any) => {
    return fetch(`/api/shared`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }).then(handleResponse);
};

export const uploadTrack = async (trackMetadata: Track, file: File, artworkBlob?: Blob): Promise<Track> => {
    const formData = new FormData();
    formData.append('audioFile', file);
    formData.append('metadata', JSON.stringify(trackMetadata));
    if (artworkBlob) {
        formData.append('artworkFile', artworkBlob, 'artwork.jpg');
    }

    const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
    });
    return handleResponse(response);
};

export const deleteTrack = (id: string) => {
    return fetch(`/api/track/${id}`, {
        method: 'DELETE',
    }).then(handleResponse);
};