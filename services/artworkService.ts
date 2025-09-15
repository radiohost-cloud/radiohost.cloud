
export const fetchArtwork = async (artist: string, title: string): Promise<string | null> => {
    if (!artist || !title) {
        return null;
    }

    // Sanitize and prepare search terms for better matching.
    const cleanArtist = artist.toLowerCase().trim();
    const cleanTitle = title.toLowerCase().trim();
    const searchTerm = `${artist} ${title}`;
    
    // Fetch a few results to find a better match. US is a good default country.
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&media=music&limit=5&country=US`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`iTunes API responded with status: ${response.status}`);
            return null;
        }

        const data = await response.json();

        if (data.resultCount > 0) {
            // Attempt to find the best match. The API isn't perfect, so we check if the
            // result's artist and title contain our search terms.
            const bestMatch = data.results.find((result: any) => 
                result.artistName && result.trackName &&
                result.artistName.toLowerCase().includes(cleanArtist) &&
                result.trackName.toLowerCase().includes(cleanTitle)
            );

            // Use the best match if found, otherwise fall back to the first result.
            const result = bestMatch || data.results[0];

            if (result && result.artworkUrl100) {
                const artworkUrl: string = result.artworkUrl100;
                // A more robust way to get a higher resolution image by replacing the size in the URL.
                return artworkUrl.replace('100x100', '600x600');
            }
        }

        return null;
    } catch (error) {
        console.error("Error fetching artwork from iTunes API:", error);
        return null;
    }
};
