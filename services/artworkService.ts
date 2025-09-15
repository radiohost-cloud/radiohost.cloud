
export const fetchArtwork = async (artist: string, title: string): Promise<string | null> => {
    if (!artist || !title) {
        return null;
    }

    const searchTerm = `${artist} ${title}`;
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&limit=1&media=music`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`iTunes API responded with status: ${response.status}`);
            return null;
        }

        const data = await response.json();
        if (data.resultCount > 0 && data.results[0].artworkUrl100) {
            const artworkUrl: string = data.results[0].artworkUrl100;
            // Replace '100x100' with a higher resolution, e.g., '600x600' for better quality
            return artworkUrl.replace(/100x100(bb)?\.jpg/, '600x600bb.jpg');
        }

        return null;
    } catch (error) {
        console.error("Error fetching artwork from iTunes API:", error);
        return null;
    }
};
