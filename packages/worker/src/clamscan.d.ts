declare module "clamscan" {
  export interface ScanResult {
    file: string;
    isInfected: boolean;
    viruses?: string[];
  }

  export interface ClamScanOptions {
    removeInfected?: boolean;
    quarantineInfected?: boolean;
    scanLog?: string | null;
    debugMode?: boolean;
    fileList?: string[] | null;
    scanRecursively?: boolean;
    preference?: "clamscan" | "clamdscan" | "clamdscan-stream";
    clamscan?: {
      path?: string;
      db?: string[] | null;
      scanArchives?: boolean;
      active?: boolean;
    };
    clamdscan?: {
      socket?: string | false;
      host?: string | false;
      port?: number | false;
      timeout?: number;
      localFallback?: boolean;
      path?: string;
      configFile?: string | null;
      multiscan?: boolean;
      reloadDb?: boolean;
      active?: boolean;
      bypassTest?: boolean;
    };
  }

  export class NodeClam {
    init(options?: ClamScanOptions): Promise<NodeClam>;
    getVersion(): Promise<string>;
    isInfected(file: string): Promise<ScanResult>;
    scanFile(file: string): Promise<ScanResult>;
    scanBuffer(buffer: Buffer, filename?: string): Promise<ScanResult>;
    scanDir(dir: string): Promise<{ goodFiles: string[]; badFiles: string[] }>;
    ping(): Promise<object>;
  }
}
