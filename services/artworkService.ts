
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
        if (data.resultCount > 0 && data.results[0]) {
            const result = data.results[0];
            // Find the best available artwork URL provided by the API
            const artworkUrl = result.artworkUrl100 || result.artworkUrl60 || result.artworkUrl30;
            
            if (artworkUrl && typeof artworkUrl === 'string') {
                // Replace '100x100' with '600x600' to get a higher resolution image.
                // This is a common and reliable trick for the iTunes API.
                return artworkUrl.replace('100x100bb.jpg', '600x600bb.jpg');
            }
        }

        return null;
    } catch (error) {
        console.error("Error fetching artwork from iTunes API:", error);
        return null;
    }
};
