export { };

declare global {
    interface Window {
        showDirectoryPicker(options?: {
            mode?: 'read' | 'readwrite';
            startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | FileSystemHandle;
        }): Promise<FileSystemDirectoryHandle>;
    }

    interface FileSystemHandle {
        readonly kind: 'file' | 'directory';
        readonly name: string;
        isSameEntry(other: FileSystemHandle): Promise<boolean>;
    }

    interface FileSystemDirectoryHandle extends FileSystemHandle {
        readonly kind: 'directory';
        getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
        getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
        removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
        resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>;
        keys(): AsyncIterableIterator<string>;
        values(): AsyncIterableIterator<FileSystemHandle>;
        entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
        requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
    }

    interface FileSystemFileHandle extends FileSystemHandle {
        readonly kind: 'file';
        getFile(): Promise<File>;
        createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
    }

    interface FileSystemWritableFileStream extends WritableStream {
        write(data: BufferSource | Blob | string): Promise<void>;
        seek(position: number): Promise<void>;
        truncate(size: number): Promise<void>;
    }
}
