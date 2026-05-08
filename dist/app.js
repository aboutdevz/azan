import { readFileSync, writeFileSync } from "fs";
import isEqual from "lodash.isequal";
import path from "path";
import soundPlay from "sound-play";
import cron from "node-cron";
import { setTimeout } from "timers/promises";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
const execAsync = promisify(exec);
const metadata = JSON.parse(readFileSync("metadata.json", "utf-8"));
const baseApiUrl = "https://api.myquran.com/v3";
const jakartaId = "58a2fc6ed39fd083f55d4182bf88826d";
const args = process.argv.slice(2);
console.log(args);
// --- State Trackers ---
const playedToday = new Set();
let currentDayTracker = new Date().getDate();
const logging = (message) => {
    const logEntry = `${new Date().toISOString()} - ${message}\n`;
    // Use path.join to ensure it writes to the correct directory
    const logPath = path.join(process.cwd(), metadata.logsFile);
    writeFileSync(logPath, logEntry, { flag: "a" });
};
// Helper function to turn "15:30" into purely minutes (930) for easy math
const timeToMinutes = (timeStr) => {
    const [hours = 0, minutes = 0] = timeStr.split(":").map(Number);
    return hours * 60 + minutes;
};
const updateSchedule = async () => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    try {
        const response = await fetch(`${baseApiUrl}/sholat/jadwal/${jakartaId}/${year}-${month}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch prayer times: ${response.statusText}`);
        }
        const data = (await response.json());
        if (isEqual(metadata.schedule.prayerTimes, data)) {
            console.log("Prayer times are already up to date.");
            return;
        }
        metadata.schedule.prayerTimes = data;
        metadata.schedule.lastUpdated = new Date().toISOString();
        const metaPath = path.join(process.cwd(), "metadata.json");
        writeFileSync(metaPath, JSON.stringify(metadata, null, 2), "utf-8");
        console.log("Prayer times updated successfully.");
        logging("Prayer times schedule updated from API.");
    }
    catch (error) {
        console.error("Error updating prayer times:", error);
        logging(`Error updating prayer times: ${error}`);
    }
};
const playAzan = async (prayerName) => {
    const azan = metadata.sounds.azans.find((a) => a.name === prayerName);
    if (!azan) {
        throw new Error(`Azan for ${prayerName} not found in metadata.`);
    }
    console.log(`Now playing: ${prayerName}...`);
    try {
        const exactFilePath = path.join(process.cwd(), "src", azan.file);
        console.log(exactFilePath);
        if (os.platform() === "win32") {
            await soundPlay.play(exactFilePath);
        }
        else {
            await execAsync(`mplayer "${exactFilePath}"`);
        }
        console.log(`Azan for ${prayerName} played successfully.`);
        logging(`Successfully played audio for: ${prayerName}`);
    }
    catch (err) {
        console.error(`Error playing azan for ${prayerName}:`, err);
        logging(`Failed to play audio for ${prayerName}: ${err}`);
        throw err;
    }
};
const checkAndPlayAzan = async () => {
    const now = new Date();
    // 1. Reset our "played" list automatically at midnight
    if (now.getDate() !== currentDayTracker) {
        playedToday.clear();
        currentDayTracker = now.getDate();
        logging("Midnight reset: Cleared played Azans list for the new day.");
    }
    const today = now.getDate().toString().padStart(2, "0");
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const year = now.getFullYear();
    const todayKey = `${year}-${month}-${today}`;
    const todaySchedule = metadata.schedule.prayerTimes.data.jadwal[todayKey];
    if (!todaySchedule) {
        console.warn(`No prayer times found for today (${todayKey}).`);
        return;
    }
    const currentTime = now.toTimeString().slice(0, 5); // Format HH:MM
    const currentMinutes = timeToMinutes(currentTime);
    // Added subuh back in!
    const prayerNames = [
        "subuh",
        "dzuhur",
        "ashar",
        "maghrib",
        "isya",
    ];
    for (const prayerName of prayerNames) {
        // 2. THE FRIDAY LOGIC: Skip Dzuhur if today is Friday (Day 5)
        if (now.getDay() === 5 && prayerName === "dzuhur") {
            continue;
        }
        const prayerTime = todaySchedule[prayerName];
        if (!prayerTime)
            continue;
        const prayerMinutes = timeToMinutes(prayerTime);
        const minutesSincePrayer = currentMinutes - prayerMinutes;
        // 3. THE BUFFER LOGIC: Plays if exactly time, or up to 5 mins late (if not played yet)
        if (minutesSincePrayer >= 0 &&
            minutesSincePrayer <= 5 &&
            !playedToday.has(prayerName)) {
            // Mark as played immediately so it doesn't trigger again in the next minute
            playedToday.add(prayerName);
            try {
                await setTimeout(1000); // Small delay to ensure any file locks are released
                await playAzan(prayerName);
                await setTimeout(2000); // Wait a bit after playing before allowing next actions
            }
            catch (error) {
                // If it fails (e.g. file error), remove it from the list so it can try again next minute
                playedToday.delete(prayerName);
            }
        }
    }
};
const testSuite = async () => {
    try {
        console.log("Running test suite...");
        await updateSchedule();
        console.log("updateSchedule test completed.");
        await setTimeout(1000);
        await playAzan("dzuhur");
        console.log("playAzan test completed.");
        await setTimeout(3000);
    }
    catch (error) {
        console.error("Test suite failed:", error);
    }
};
function main() {
    console.log("Starting Azan Scheduler...");
    logging("===============================");
    logging("Azan Scheduler app started.");
    // Run an initial check for the schedule
    updateSchedule();
    // Schedule the API update to run automatically every night at 1:00 AM
    cron.schedule("0 1 * * *", () => {
        updateSchedule();
    });
    // Schedule the time checker to run every single minute
    cron.schedule("* * * * *", () => {
        checkAndPlayAzan();
    });
    console.log("🕌 Scheduler is running in the background. Keep this terminal open!");
}
if (args.includes("test")) {
    testSuite();
}
else {
    // Start the actual background process instead of the test suite
    main();
}
//# sourceMappingURL=app.js.map