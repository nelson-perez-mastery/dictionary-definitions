import fs, { read, write } from 'fs';

export const EMPTY_ARRAY: [] = [];


export function loadJson<T>(filename: string, defaultValue: T): T {
    if(fs.existsSync(filename)) {
        let data: string;
        Log.time(`readFileSync() ${filename}`, () => {
            data = fs.readFileSync(filename, {encoding: "utf-8"});
        });

        let json: any;
        Log.time(`JSON.parse(): ${filename}`, () => {
            json = JSON.parse(data);
        });
        return json;
    }
    return defaultValue;
}

export function saveJson(...args: {filename: string, json: any}[]) {
    for(const arg of args) {
        const tempFilename = arg.filename + '.temp';
        const text = Log.time(`JSON.stringify(): ${tempFilename}`, () => {
            try {
                const obj = JSON.stringify(arg.json);
                return obj
            }
            catch(e) {
                console.error({error: e});
            }
        });
        Log.time(`writeSync() ${tempFilename}`, () => {
            fs.writeFileSync(tempFilename, text, {encoding: "utf-8"});
        });
    }

    for(const arg of args) {
        const tempFilename = arg.filename + '.temp';
        Log.time(`rename() ${arg.filename}`, () => {
            fs.renameSync(tempFilename, arg.filename);
        });
    }
}

declare global {
    interface Number {
        toMegaByteString: () => string
    }
}

Number.prototype.toMegaByteString = function(): string {
    const mb: Number = this.valueOf() / 1024 / 1024
    const formatedMb = mb.toLocaleString(
        'en-US',
        {minimumFractionDigits: 2, maximumFractionDigits: 2}
    ) + 'MB';
    return formatedMb;
};

export namespace Memory {
    export function inMegaBytes() {
        const usage = process.memoryUsage();
        const entries = Object.entries(usage);

        const formatedEntries = entries.map(([k,v]) => {
            const formatedMb = v.toMegaByteString();
            return [k, formatedMb];
        });
        
        const formatedUsage = Object.fromEntries(formatedEntries);
    }
}

export namespace Log {
    function prepare(message: any) {
        const date = new Date();
        const dateStr = date.toLocaleString() + '.' + date.getMilliseconds();
        if(typeof message === "string") {
            message = `[${dateStr}] ${message}`;
        }
        else {
            message = {...message, date: dateStr};
        }

        return message;
    }

    export function memory() {
        const usage = process.memoryUsage();
        const entries = Object.entries(usage);

        const formatedEntries = entries.map(([k,v]) => {
            const mb = v / 1024 / 1024
            const formatedMb = mb.toLocaleString(
                'en-US',
                {minimumFractionDigits: 2, maximumFractionDigits: 2}
            ) + 'MB';
            return [k, formatedMb];
        });
        
        const formatedUsage = Object.fromEntries(formatedEntries);
        info(formatedUsage);
    }

    export function info(message: any, ...optionalArgs: any) {
        const prepared = prepare(message);
        console.info(prepared, ...optionalArgs);
    }

    export function error(message: any, ...optionalArgs: any) {
        const prepared = prepare(message);
        console.error(prepared, ...optionalArgs);
    }

    export function warn(message: any, ...optionalArgs: any) {
        const prepared = prepare(message);
        console.warn(prepared, ...optionalArgs);
    }
    
    export function time(label: string, func: () => any) {
        const prepared = prepare(label);
        var isPromise = false;
        console.time(prepared);
        try {
            const result = func();
            if(result instanceof Promise) {
                isPromise = true;
                return result.finally(() => {
                    console.timeEnd(prepared);
                });
            }
            return result;
        }
        finally {
            if(!isPromise) {
                console.timeEnd(prepared);
            }
        }
    }
}