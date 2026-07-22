/**
 * uWaterloo Schedule Exporter
 * (c) 2015-Present, Baraa Hamodi
 * (c) 2018-Present, Xierumeng with permission from Baraa Hamodi
 */

"use strict";

const DEBUG = false;
const TIMEZONE = "America/Toronto";
const PANEL_ID = "uw-schedule-exporter-panel";

const COMPONENT_LABELS = {
  LEC: "Lectures",
  TUT: "Tutorials",
  LAB: "Labs",
  TST: "Tests",
  SEM: "Seminars",
};

function logger(message) {
  if (DEBUG) {
    console.log("uwaterloo-schedule-exporter: " + message);
  }
}

// ---------------------------------------------------------------------------
// iCalendar formatting helpers
// ---------------------------------------------------------------------------

/**
 * Converts a Date object into the required calendar format.
 * @param {Date} date
 * @return {string} formatted date ('20150122')
 */
function getDateString(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}${month}${day}`;
}

/**
 * Converts a time string into the required calendar format.
 * @param {string} time ('4:30PM')
 * @return {string} formatted time ('163000')
 */
function getTimeString(time) {
  const match = time.match(/(\d\d?):(\d\d)([AP]M)?/);
  let hours = parseInt(match[1], 10);
  if (match[3] === "PM" && hours < 12) {
    hours += 12;
  } else if (match[3] === "AM" && hours === 12) {
    hours = 0;
  }
  return String(hours).padStart(2, "0") + match[2] + "00";
}

/**
 * Combines date and time strings into the required calendar format.
 * @param {Date} date
 * @param {string} time ('4:30PM')
 * @return {string} formatted date and time string ('20150122T163000')
 */
function getDateTimeString(date, time) {
  return getDateString(date) + "T" + getTimeString(time);
}

/**
 * Parses a 'MM/DD/YYYY' date string into a Date.
 * @param {string} dateString
 * @return {Date}
 */
function parseDate(dateString) {
  const [month, day, year] = dateString.split("/").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Combines days of the week that an event occurs into the required calendar format.
 * @param {string} daysOfWeek ('MTWThF')
 * @return {string} formatted days of the week string ('MO,TU,WE,TH,FR')
 */
function getDaysOfWeek(daysOfWeek) {
  const formattedDays = [];
  if (daysOfWeek.match(/S[^a]/)) formattedDays.push("SU");
  if (daysOfWeek.match(/M/)) formattedDays.push("MO");
  if (daysOfWeek.match(/T[^h]/)) formattedDays.push("TU");
  if (daysOfWeek.match(/W/)) formattedDays.push("WE");
  if (daysOfWeek.match(/Th/)) formattedDays.push("TH");
  if (daysOfWeek.match(/F/)) formattedDays.push("FR");
  if (daysOfWeek.match(/S[^u]/)) formattedDays.push("SA");
  return formattedDays.join(",");
}

/**
 * Increments starting date to match day of repeating event in RRULE.
 * @param {Date} date
 * @param {Array<string>} eventDays
 * @return {Date} date
 */
function incrementDateDay(date, eventDays) {
  const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  while (!eventDays.includes(days[date.getDay()])) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

/**
 * Escapes text for use in an iCalendar text field (RFC 5545 3.3.11).
 * @param {string} text
 * @return {string}
 */
function escapeICalText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/(\r\n|\n|\r)/g, "\\n");
}

/**
 * Folds an iCalendar content line to the RFC 5545 75-octet limit.
 * @param {string} line
 * @return {string}
 */
function foldLine(line) {
  const parts = [];
  while (line.length > 74) {
    parts.push(line.slice(0, 74));
    line = " " + line.slice(74);
  }
  parts.push(line);
  return parts.join("\r\n");
}

/**
 * Wraps calendar event content into a complete iCalendar document.
 * @param {string} iCalContent
 * @return {string} formatted calendar content
 */
function wrapICalContent(iCalContent) {
  return (
    "BEGIN:VCALENDAR\r\n" +
    "METHOD:PUBLISH\r\n" +
    "PRODID:-//Baraa Hamodi/uWaterloo Schedule Exporter//EN\r\n" +
    "VERSION:2.0\r\n" +
    "X-WR-CALNAME:UWQuest Export\r\n" +
    `X-WR-TIMEZONE:${TIMEZONE}\r\n` +
    "BEGIN:VTIMEZONE\r\n" +
    `TZID:${TIMEZONE}\r\n` +
    "BEGIN:STANDARD\r\n" +
    "DTSTART:19701101T020000\r\n" +
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\n" +
    "TZOFFSETFROM:-0400\r\n" +
    "TZOFFSETTO:-0500\r\n" +
    "TZNAME:EST\r\n" +
    "END:STANDARD\r\n" +
    "BEGIN:DAYLIGHT\r\n" +
    "DTSTART:19700308T020000\r\n" +
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\n" +
    "TZOFFSETFROM:-0500\r\n" +
    "TZOFFSETTO:-0400\r\n" +
    "TZNAME:EDT\r\n" +
    "END:DAYLIGHT\r\n" +
    "END:VTIMEZONE\r\n" +
    iCalContent +
    "END:VCALENDAR\r\n"
  );
}

/**
 * Builds a single VEVENT from a scraped class meeting.
 * @param {Object} meeting
 * @return {string}
 */
function buildEvent(meeting) {
  const stamp =
    new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const uid =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now();

  const description = escapeICalText(
    [
      `Course Name: ${meeting.courseName}`,
      `Section: ${meeting.section}`,
      `Instructor: ${meeting.instructor}`,
      `Component: ${meeting.component}`,
      `Class Number: ${meeting.classNumber}`,
      `Days/Times: ${meeting.daysTimes}`,
      `Start/End Date: ${meeting.startEndDate}`,
      `Location: ${meeting.room}`,
    ].join("\n")
  );

  const lines = [
    "BEGIN:VEVENT",
    `DTSTART;TZID=${TIMEZONE}:` +
      getDateTimeString(meeting.startDate, meeting.startTime),
    `DTEND;TZID=${TIMEZONE}:` +
      getDateTimeString(meeting.startDate, meeting.endTime),
    `RRULE:FREQ=WEEKLY;UNTIL=` +
      getDateTimeString(meeting.endDate, meeting.endTime) +
      `Z;BYDAY=${meeting.daysOfWeek};`,
    `DTSTAMP:${stamp}`,
    `UID:${uid}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${escapeICalText(meeting.room)}`,
    "SEQUENCE:0",
    "STATUS:CONFIRMED",
    `SUMMARY:${escapeICalText(
      `${meeting.courseCode} (${meeting.component}) in ${meeting.room}`
    )}`,
    "TRANSP:OPAQUE",
    "END:VEVENT",
  ];

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Page scraping
// ---------------------------------------------------------------------------

/**
 * Returns the trimmed-free text of the first element matching the selector.
 * @param {Element} root
 * @param {string} selector
 * @return {string}
 */
function textOf(root, selector) {
  const el = root.querySelector(selector);
  return el ? el.textContent : "";
}

/**
 * Scrapes all class meetings from the List View and groups VEVENTs by component.
 * @return {{events: Object<string, Array<string>>, count: number}}
 */
function collectEvents() {
  const events = {};
  let count = 0;

  document.querySelectorAll(".PSGROUPBOXWBO").forEach((courseBox) => {
    const eventTitle = textOf(courseBox, ".PAGROUPDIVIDER").split(" - ");
    const courseCode = eventTitle[0];
    const courseName = eventTitle[1];
    logger(`collect:course=${courseCode}`);

    courseBox.querySelectorAll(".PSLEVEL3GRID tr").forEach((row) => {
      let classNumber = textOf(row, 'span[id*="DERIVED_CLS_DTL_CLASS_NBR"]');
      let section = textOf(row, 'a[id*="MTG_SECTION"]');
      let component = textOf(row, 'span[id*="MTG_COMP"]');

      // Continuation rows leave these cells blank (a single nbsp); walk back
      // to the row that owns this meeting pattern.
      let prev = row.previousElementSibling;
      while (classNumber.length === 1 && prev) {
        classNumber = textOf(prev, 'span[id*="DERIVED_CLS_DTL_CLASS_NBR"]');
        section = textOf(prev, 'a[id*="MTG_SECTION"]');
        component = textOf(prev, 'span[id*="MTG_COMP"]');
        prev = prev.previousElementSibling;
      }

      const daysTimes = textOf(row, 'span[id*="MTG_SCHED"]');
      const startEndTimes = daysTimes.match(/\d\d?:\d\d([AP]M)?/g);
      if (!startEndTimes) {
        return;
      }

      const daysOfWeek = getDaysOfWeek(daysTimes.match(/[A-Za-z]* /)[0]);
      const room = textOf(row, 'span[id*="MTG_LOC"]');
      const instructor = textOf(
        row,
        'span[id*="DERIVED_CLS_DTL_SSR_INSTR_LONG"]'
      ).replace(/(\r\n|\n|\r)/gm, "");
      const startEndDate = textOf(row, 'span[id*="MTG_DATES"]');

      // Increment the start date until its day matches one of the days in
      // daysOfWeek, so the event does not occur before its first meeting.
      const startDate = incrementDateDay(
        parseDate(startEndDate.substring(0, 10)),
        daysOfWeek.split(",")
      );

      // End the event one day after the actual end date. Technically, the
      // RRULE UNTIL field should be the start time of the last occurrence.
      // However, since the field only accepts UTC time and America/Toronto is
      // always behind UTC, setting the end date one day later guarantees no
      // extra occurrence.
      const endDate = parseDate(startEndDate.substring(13, 23));
      endDate.setDate(endDate.getDate() + 1);

      const eventContent = buildEvent({
        courseCode,
        courseName,
        classNumber,
        section,
        component,
        daysTimes,
        startEndDate,
        daysOfWeek,
        startDate,
        endDate,
        startTime: startEndTimes[0],
        endTime: startEndTimes[1],
        room,
        instructor,
      });

      if (!events[component]) {
        events[component] = [];
      }
      events[component].push(eventContent);
      count++;
    });
  });

  logger(`collect:done count=${count}`);
  return { events, count };
}

/**
 * Best-effort student name for use in file names.
 * @return {string}
 */
function getStudentName() {
  const name = textOf(document, "#DERIVED_SSTSNAV_PERSON_NAME")
    .trim()
    .toLowerCase()
    .replace(/ /g, "-");
  return name || "uwaterloo";
}

// ---------------------------------------------------------------------------
// ZIP creation (store method, no compression — RFC-free and dependency-free)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Builds an uncompressed ZIP archive.
 * @param {Array<{name: string, content: string}>} files
 * @return {Blob}
 */
function createZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate =
    ((now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate();

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header signature
    local.setUint16(4, 20, true); // version needed to extract
    local.setUint16(6, 0x0800, true); // UTF-8 file name flag
    local.setUint16(8, 0, true); // store (no compression)
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed size
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra field length
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true); // central directory signature
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true); // version needed to extract
    dir.setUint16(8, 0x0800, true); // UTF-8 file name flag
    dir.setUint16(10, 0, true); // store
    dir.setUint16(12, dosTime, true);
    dir.setUint16(14, dosDate, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true); // local header offset
    central.push(new Uint8Array(dir.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory signature
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true); // central directory offset
  chunks.push(...central, new Uint8Array(end.buffer));

  return new Blob(chunks, { type: "application/zip" });
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function makeButton(label, onClick, primary) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText = [
    "font: 600 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    "padding: 7px 12px",
    "border-radius: 6px",
    "cursor: pointer",
    "border: 1px solid " + (primary ? "#000" : "#c9c9c9"),
    "background: " + (primary ? "#ffd54f" : "#fff"),
    "color: #1a1a1a",
    "transition: filter 0.15s",
  ].join(";");
  button.addEventListener("mouseenter", () => {
    button.style.filter = "brightness(0.93)";
  });
  button.addEventListener("mouseleave", () => {
    button.style.filter = "";
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick();
  });
  return button;
}

/**
 * Injects the exporter panel with per-component and zip download buttons.
 * @param {Object<string, Array<string>>} events VEVENTs grouped by component
 * @param {number} count
 */
function renderPanel(events, count) {
  const anchor =
    document.querySelector(".PATRANSACTIONTITLE") ||
    document.querySelector(".PSGROUPBOXWBO");
  if (!anchor) {
    return;
  }

  const studentName = getStudentName();
  const files = Object.keys(events)
    .sort()
    .map((component) => ({
      component,
      name: `${studentName}-${component.toLowerCase()}-schedule.ics`,
      content: wrapICalContent(events[component].join("")),
    }));

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.style.cssText = [
    "margin: 10px 0",
    "padding: 12px 14px",
    "border: 1px solid #e0e0e0",
    "border-left: 4px solid #ffd54f",
    "border-radius: 8px",
    "background: #fafafa",
    "box-shadow: 0 1px 3px rgba(0,0,0,0.08)",
    "display: flex",
    "flex-wrap: wrap",
    "align-items: center",
    "gap: 8px",
  ].join(";");

  const title = document.createElement("span");
  title.textContent = `Schedule Exporter — ${count} class ${
    count === 1 ? "meeting" : "meetings"
  } found`;
  title.style.cssText =
    "font: 700 13px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; margin-right: 6px";
  panel.appendChild(title);

  files.forEach((file) => {
    const label = COMPONENT_LABELS[file.component] || file.component;
    panel.appendChild(
      makeButton(`${label} (.ics)`, () => {
        triggerDownload(
          new Blob([file.content], { type: "text/calendar;charset=utf-8" }),
          file.name
        );
      })
    );
  });

  if (files.length > 1) {
    panel.appendChild(
      makeButton("Download All (.zip)", () => {
        triggerDownload(createZip(files), `${studentName}-schedule.zip`);
      }, true)
    );
  }

  anchor.insertAdjacentElement("afterend", panel);
  logger("panel:rendered files=" + files.length);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Renders the panel if the schedule List View is present and not yet handled.
 * Quest loads the schedule into the Activity Guide content area via AJAX
 * after the initial page load, so this runs both at document ready and on
 * subsequent DOM changes (via MutationObserver) — no more toggling between
 * Weekly Calendar View and List View to make the buttons appear.
 */
function tryRender() {
  if (document.getElementById(PANEL_ID)) {
    return;
  }
  if (!document.querySelector(".PSGROUPBOXWBO")) {
    return;
  }
  const { events, count } = collectEvents();
  if (count === 0) {
    logger("tryRender:no meetings found (likely Weekly Calendar View)");
    return;
  }
  renderPanel(events, count);
}

logger("init url=" + location.href);
tryRender();

let renderTimer = null;
const observer = new MutationObserver(() => {
  if (renderTimer) {
    return;
  }
  renderTimer = setTimeout(() => {
    renderTimer = null;
    tryRender();
  }, 300);
});
observer.observe(document.documentElement, { childList: true, subtree: true });
