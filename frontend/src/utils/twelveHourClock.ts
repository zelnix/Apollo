// Every time Apollo shows is on the 12-hour clock ("3:16 pm"), in this phone's own time zone. Installed once at
// start-up (app/_layout.tsx), so every screen, report and message built on the phone follows it without each
// call having to ask. A call that sets its own hour12/hourCycle keeps it. Pure: no React, no native imports.

type Options = Intl.DateTimeFormatOptions | undefined;

/** The same options, on the 12-hour clock: "3:16 pm", never "03:16 pm" or "15:16". */
export function twelveHour(options: Options): Intl.DateTimeFormatOptions {
  if (options && (options.hour12 !== undefined || options.hourCycle !== undefined)) return options;
  const next: Intl.DateTimeFormatOptions = { ...options, hour12: true };
  if (next.hour === "2-digit") next.hour = "numeric";
  return next;
}

let installed = false;

/** Makes Date's toLocaleString / toLocaleTimeString use the 12-hour clock by default. Safe to call twice. */
export function installTwelveHourClock(): void {
  if (installed) return;
  installed = true;
  const toLocaleString = Date.prototype.toLocaleString;
  const toLocaleTimeString = Date.prototype.toLocaleTimeString;
  Date.prototype.toLocaleString = function (this: Date, locales?: Intl.LocalesArgument, options?: Options) {
    return toLocaleString.call(this, locales, twelveHour(options));
  };
  Date.prototype.toLocaleTimeString = function (this: Date, locales?: Intl.LocalesArgument, options?: Options) {
    return toLocaleTimeString.call(this, locales, twelveHour(options));
  };
}
