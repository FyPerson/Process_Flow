/**
 * Generates a unique name based on a base name and a set of existing names.
 * If the base name already exists, it appends a suffix like "_1", "_2", etc.
 * 
 * @param baseName The desired name.
 * @param existingNames A Set or Array of existing names to check against.
 * @returns A unique name.
 */
export function getUniqueName(baseName: string, existingNames: Set<string> | string[]): string {
    const namesSet = Array.isArray(existingNames) ? new Set(existingNames) : existingNames;

    // If the base name doesn't exist, return it as is
    if (!namesSet.has(baseName)) {
        return baseName;
    }

    // Otherwise, try appending suffixes until we find a unique name
    let counter = 1;
    let newName = `${baseName}_${counter}`;

    while (namesSet.has(newName)) {
        counter++;
        newName = `${baseName}_${counter}`;
    }

    return newName;
}
