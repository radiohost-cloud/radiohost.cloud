import { type User, type Track } from '../types';

const handleResponse = async (response: Response) => {
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errorData.message || 'An API error occurred');
    }
    return response.json();
};

export const login = async (email: string, password: string): Promise<User | null> => {
    const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    return handleResponse(response);
};

export const signup = async (user: User): Promise<User | null> => {
    const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
    });
    return handleResponse(response);
};

export const getAllUsers = async (): Promise<User[]> => {
    const response = await fetch('/api/users');
    return handleResponse(response);
};

export const updateUserRole = async (email: string, role: 'studio' | 'presenter'): Promise<User> => {
    const response = await fetch(`/api/users/${email}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
    });
    return handleResponse(response);
};

// Media functions are placeholders as the server handles this via filesystem watching.
export const addTrack = async (track: Track, file?: File): Promise<Track> => {
    console.warn("apiService.addTrack is a placeholder. File management should be done on the server's filesystem.");
    return track;
};

export const deleteTrack = async (track: Track): Promise<void> => {
    console.warn("apiService.deleteTrack is a placeholder. File management should be done on the server's filesystem.");
};
