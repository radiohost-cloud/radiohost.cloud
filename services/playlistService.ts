
import { type SequenceItem, type PlayoutPolicy, TimeMarkerType, type Track } from '../types';

export interface TimelineEntry {
    startTime: Date;
    endTime: Date;
    duration: number;
    isSkipped?: boolean;
    shortenedBy?: number;
}

export const calculateTimeline = (
    items: SequenceItem[],
    policy: PlayoutPolicy,
    initialStartTime: Date,
): Map<string, TimelineEntry> => {
    const timeline = new Map<string, TimelineEntry>();
    let currentTime = new Date(initialStartTime);

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        if (timeline.has(item.id)) { // Already processed (e.g., by a marker lookahead)
            const entry = timeline.get(item.id)!;
            if (!entry.isSkipped) {
               currentTime = new Date(entry.endTime);
            }
            continue;
        }

        if (item.type === 'marker') {
            const markerTime = new Date(item.time);
            
            if (markerTime > currentTime) { // Marker is in the future
                if (item.markerType === TimeMarkerType.HARD) {
                    const previousTrack = i > 0 ? (items[i - 1] as Track) : null;
                    if (previousTrack && previousTrack.type !== 'marker') {
                        const prevEntry = timeline.get(previousTrack.id);
                        if (prevEntry) {
                            const originalEndTime = new Date(prevEntry.startTime.getTime() + prevEntry.duration * 1000);
                            if (markerTime < originalEndTime) {
                                const shortenedBy = (originalEndTime.getTime() - markerTime.getTime()) / 1000;
                                prevEntry.endTime = markerTime;
                                prevEntry.shortenedBy = shortenedBy;
                                timeline.set(previousTrack.id, prevEntry);
                            }
                        }
                    }
                    currentTime = markerTime;
                } else { // Soft marker
                    // The next track will start after the current one finishes or at the marker time, whichever is later.
                    currentTime = new Date(Math.max(currentTime.getTime(), markerTime.getTime()));
                }
            } else { // Marker is in the past, jump time forward
                 currentTime = markerTime;
            }
            continue; // Markers don't have duration in the timeline itself
        }

        // It's a track
        const track: Track = item;
        const crossfade = (i > 0 && items[i-1].type !== 'marker' && policy.crossfadeEnabled) ? policy.crossfadeDuration : 0;
        const trackStartTime = new Date(currentTime.getTime() - crossfade * 1000);
        
        const entry: TimelineEntry = {
            startTime: trackStartTime,
            endTime: new Date(trackStartTime.getTime() + track.duration * 1000),
            duration: track.duration,
            isSkipped: false,
        };
        timeline.set(track.id, entry);
        
        // Lookahead for soft markers that might cause this track to be skipped.
        for (let j = i + 1; j < items.length; j++) {
            const nextItem = items[j];
            if (nextItem.type === 'marker' && nextItem.markerType === TimeMarkerType.SOFT) {
                const markerTime = new Date(nextItem.time);
                if (markerTime < entry.endTime) {
                    // This track will be skipped by the soft marker.
                    entry.isSkipped = true;
                    timeline.set(track.id, entry);
                    // The time doesn't advance past this track's start time.
                    currentTime = new Date(trackStartTime); // Revert currentTime
                    break; 
                }
            } else if (nextItem.type !== 'marker') {
                 break; // Stop lookahead at the next track
            }
        }

        if (!entry.isSkipped) {
            currentTime = new Date(entry.endTime);
        }
    }

    return timeline;
};
