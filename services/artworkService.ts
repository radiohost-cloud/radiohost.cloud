const cleanSearchTerm = (text: string): string => {
    if (!text) return '';
    // This function sanitizes the search query to improve API matching.
    return text
        .toLowerCase()
        .replace(/\(feat\..*?\)/g, '')      // remove "(feat. ...)"
        .replace(/\[feat\..*?\]/g, '')      // remove "[feat. ...]"
        .replace(/\((.*?remix|radio edit|official.*?)\)/g, '') // remove common parenthesized terms
        .replace(/\[(.*?remix|radio edit|official.*?)\]/g, '') // remove common bracketed terms
        .replace(/lyrics/g, '')             // remove "lyrics"
        .replace(/-/g, ' ')                // replace dash with space for better tokenization
        .replace(/[^\w\s]/g, '')           // remove all non-word, non-space characters
        .trim()                             // remove leading/trailing whitespace
        .replace(/\s+/g, ' ');              // collapse multiple spaces into one
};

export const fetchArtwork = async (artist: string, title: string): Promise<string | null> => {
    if (!artist || !title) {
        return null;
    }

    const cleanedArtist = cleanSearchTerm(artist);
    const cleanedTitle = cleanSearchTerm(title);

    // Use cleaned terms if they are not empty, otherwise fallback to original.
    const searchTerm = `${cleanedArtist || artist} ${cleanedTitle || title}`;
    
    // Increased limit to 5 to have more chances to find a good match.
    // Added country=US to have more consistent results.
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&limit=5&media=music&country=US`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error(`iTunes API responded with status: ${response.status}`);
            return null;
        }

        const data = await response.json();

        if (data.resultCount > 0) {
            // Find the best match. The API sometimes returns results where the main artist 
            // is a secondary artist or is part of a compilation. We prefer a result where the 
            // artist name is a close match to our query.
            const bestResult = data.results.find((result: any) => 
                result.artistName && cleanSearchTerm(result.artistName).includes(cleanedArtist)
            ) || data.results[0]; // Fallback to the first result if no better match is found
            
            if (bestResult && bestResult.artworkUrl100) {
                const artworkUrl: string = bestResult.artworkUrl100;
                // Replace '100x100' with a higher resolution for better quality.
                // This also handles URLs that might have different suffixes like 'bb.jpg' or just '.jpg'
                return artworkUrl.replace(/100x100(bb)?\.(jpg|png|jpeg)/, '600x600bb.jpg');
            }
        }

        return null;
    } catch (error) {
        console.error("Error fetching artwork from iTunes API:", error);
        return null;
    }
};