import * as path from 'path';
import * as os from 'os';
import * as jwt from 'jsonwebtoken';
import * as vscode from 'vscode';
import * as fs from 'fs';
import { log } from '../utils/logger';
import { execSync } from 'child_process';

// Importar sqlite3 dinámicamente para evitar problemas en tiempo de compilación
let sqlite3: any = null;

/**
 * Inicializa el módulo sqlite3 de manera dinámica
 */
async function initSqlite3() {
    if (!sqlite3) {
        try {
            // Importación dinámica de sqlite3
            const module = await import('sqlite3');
            sqlite3 = module;
            log('[Database] SQLite3 initialized successfully');
        } catch (error: any) {
            log('[Database] Error initializing SQLite3: ' + error.message, true);
            throw error;
        }
    }
    return sqlite3;
}

export function getCursorDBPath(): string {
    // Check for custom path in settings
    const config = vscode.workspace.getConfiguration('cursorStats');
    const customPath = config.get<string>('customDatabasePath');
    
    if (customPath && customPath.trim() !== '') {
        log(`[Database] Using custom path: ${customPath}`);
        return customPath;
    }
    const folderName = vscode.env.appName;

    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || '', folderName, 'User', 'globalStorage', 'state.vscdb');
    } else if (process.platform === 'linux') {
        const isWSL = vscode.env.remoteName === 'wsl';
        if (isWSL) {
            const windowsUsername = getWindowsUsername();
            if (windowsUsername) {
                return path.join('/mnt/c/Users', windowsUsername, 'AppData/Roaming', folderName, 'User/globalStorage/state.vscdb');
            }
        }
        return path.join(os.homedir(), '.config', folderName, 'User', 'globalStorage', 'state.vscdb');
    } else if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', folderName, 'User', 'globalStorage', 'state.vscdb');
    }
    return path.join(os.homedir(), '.config', folderName, 'User', 'globalStorage', 'state.vscdb');
}

export async function getCursorTokenFromDB(): Promise<string | undefined> {
    return new Promise(async (resolve) => {
        try {
            const dbPath = getCursorDBPath();
            log(`[Database] Attempting to open database at: ${dbPath}`);

            if (!fs.existsSync(dbPath)) {
                log('[Database] Database file does not exist', true);
                return resolve(undefined);
            }

            // Verificar el tamaño del archivo
            const stats = fs.statSync(dbPath);
            const fileSizeGB = stats.size / (1024 * 1024 * 1024);
            log(`[Database] Database file size: ${stats.size} bytes (${fileSizeGB.toFixed(2)} GB)`);

            try {
                // Inicializar sqlite3
                const sqlite = await initSqlite3();
                const db = new sqlite.Database(dbPath, sqlite.OPEN_READONLY, (err: Error | null) => {
                    if (err) {
                        log('[Database] Error opening database with SQLite3: ' + err.message, true);
                        return resolve(undefined);
                    }

                    log('[Database] Connected to database using SQLite3');
                    
                    // Consultar el token
                    db.get("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'", (err: Error | null, row: any) => {
                        if (err) {
                            log('[Database] Error querying database: ' + err.message, true);
                            db.close();
                            return resolve(undefined);
                        }

                        if (!row) {
                            log('[Database] No token found in database');
                            db.close();
                            return resolve(undefined);
                        }

                        const token = row.value;
                        log(`[Database] Token starts with: ${token.substring(0, 20)}...`);

                        try {
                            const decoded = jwt.decode(token, { complete: true });
                            if (!decoded || !decoded.payload || !decoded.payload.sub) {
                                log('[Database] Invalid JWT structure: ' + JSON.stringify({ decoded }), true);
                                db.close();
                                return resolve(undefined);
                            }

                            const sub = decoded.payload.sub.toString();
                            const userId = sub.split('|')[1];
                            const sessionToken = `${userId}%3A%3A${token}`;
                            log(`[Database] Created session token, length: ${sessionToken.length}`);
                            
                            db.close();
                            return resolve(sessionToken);
                        } catch (error: any) {
                            log('[Database] Error processing token: ' + error, true);
                            log('[Database] Error details: ' + JSON.stringify({
                                name: error.name,
                                message: error.message,
                                stack: error.stack
                            }), true);
                            db.close();
                            return resolve(undefined);
                        }
                    });
                });
            } catch (error: any) {
                // Fallback a sql.js (legacy) si sqlite3 falla
                log('[Database] Error with SQLite3, falling back to sql.js (warning: may fail with large databases)', true);
                
                try {
                    // Si el archivo es demasiado grande, es mejor no intentar con sql.js
                    if (fileSizeGB > 1.5) {
                        log('[Database] Database file too large for sql.js fallback (>1.5GB)', true);
                        return resolve(undefined);
                    }
                    
                    // Importar sql.js dinámicamente
                    const initSqlJs = (await import('sql.js')).default;
                    const dbBuffer = fs.readFileSync(dbPath);
                    const SQL = await initSqlJs();
                    const db = new SQL.Database(new Uint8Array(dbBuffer));

                    const result = db.exec("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'");
                    
                    if (!result.length || !result[0].values.length) {
                        log('[Database] No token found in database (sql.js fallback)');
                        db.close();
                        return resolve(undefined);
                    }

                    const token = result[0].values[0][0] as string;
                    log(`[Database] Token starts with (sql.js fallback): ${token.substring(0, 20)}...`);

                    try {
                        const decoded = jwt.decode(token, { complete: true });
                        if (!decoded || !decoded.payload || !decoded.payload.sub) {
                            log('[Database] Invalid JWT structure: ' + JSON.stringify({ decoded }), true);
                            db.close();
                            return resolve(undefined);
                        }

                        const sub = decoded.payload.sub.toString();
                        const userId = sub.split('|')[1];
                        const sessionToken = `${userId}%3A%3A${token}`;
                        log(`[Database] Created session token, length: ${sessionToken.length}`);
                        db.close();
                        return resolve(sessionToken);
                    } catch (error: any) {
                        log('[Database] Error processing token: ' + error, true);
                        log('[Database] Error details: ' + JSON.stringify({
                            name: error.name,
                            message: error.message,
                            stack: error.stack
                        }), true);
                        db.close();
                        return resolve(undefined);
                    }
                } catch (fallbackError: any) {
                    log('[Database] SQL.js fallback also failed: ' + fallbackError.message, true);
                    return resolve(undefined);
                }
            }
        } catch (error: any) {
            log('[Database] Error accessing database: ' + error.message, true);
            log('[Database] Database error details: ' + JSON.stringify({
                message: error.message,
                stack: error.stack
            }), true);
            return resolve(undefined);
        }
    });
}

export function getWindowsUsername(): string | undefined {
    try {
      // Executes cmd.exe and echoes the %USERNAME% variable
      const result = execSync('cmd.exe /C "echo %USERNAME%"', { encoding: 'utf8' });
      const username = result.trim();
      return username || undefined;
    } catch (error) {
      console.error('Error getting Windows username:', error);
      return undefined;
    }
}
