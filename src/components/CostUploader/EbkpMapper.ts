import { CostItem } from "./types";

// Define ProjectElement type locally to avoid the import issue
interface ProjectElement {
  id: string;
  ebkpCode: string;
  quantity: number;
  area: number;
  description?: string;
  category?: string;
  level?: string;
}

/**
 * Utility class for mapping eBKP codes between IFC elements and Excel files
 */
export class EbkpMapper {
  private projectElements: ProjectElement[] = [];
  private ebkpMap: Record<string, ProjectElement[]> = {};

  /**
   * Initialize the mapper with project elements
   */
  constructor(projectElements?: ProjectElement[]) {
    if (projectElements) {
      this.setProjectElements(projectElements);
    }
  }

  /**
   * Set project elements and build the eBKP map
   */
  setProjectElements(elements: ProjectElement[]) {
    this.projectElements = elements;

    // Build a map for quick access by eBKP code
    this.ebkpMap = {};
    elements.forEach((element) => {
      const normalizedCode = this.normalizeEbkpCode(element.ebkpCode);
      if (!this.ebkpMap[normalizedCode]) {
        this.ebkpMap[normalizedCode] = [];
      }
      this.ebkpMap[normalizedCode].push(element);
    });

    console.log(
      `EbkpMapper loaded ${elements.length} elements with ${
        Object.keys(this.ebkpMap).length
      } unique codes`
    );
  }

  /**
   * Normalize eBKP code to ensure consistent matching, with special handling for Excel vs DB code formats
   */
  normalizeEbkpCode(code: string): string {
    if (!code) return "";

    console.log(`Normalizing eBKP code: '${code}'`);

    // Convert to uppercase and trim
    const upperCode = code.toUpperCase().trim();

    // Remove spaces and any non-alphanumeric characters except dots
    // This helps handle cases where there might be extra spaces or characters
    const normalized = upperCode.replace(/\s+/g, "");

    // Extract the letter part and number parts
    const match = normalized.match(/([A-Z]+)([0-9.]+)/);
    if (!match) {
      console.log(
        `Code '${code}' doesn't match expected format - returning as is`
      );
      return normalized; // Not a recognized format, return as is
    }

    const letter = match[1]; // e.g., "C"
    const numbers = match[2]; // e.g., "01.01" or "1.1"

    // Now handle the number part
    let normalizedNumbers = "";
    if (numbers.includes(".")) {
      // Case like "C01.01" or "C1.1"
      const parts = numbers.split(".");
      normalizedNumbers = parts
        .map((part) => parseInt(part, 10).toString())
        .join(".");
    } else {
      // Case like "C01" or "C1"
      normalizedNumbers = parseInt(numbers, 10).toString();
    }

    // Combine back
    const result = letter + normalizedNumbers;

    console.log(`Normalized '${code}' -> '${result}'`);
    return result;
  }

  /**
   * Get all elements for a specific eBKP code
   */
  getElementsForEbkp(ebkpCode: string): ProjectElement[] {
    const normalizedCode = this.normalizeEbkpCode(ebkpCode);
    const elements = this.ebkpMap[normalizedCode] || [];
    console.log(
      `Looking up code '${ebkpCode}' (normalized: '${normalizedCode}'): found ${elements.length} elements`
    );

    // If no elements found, try a more flexible matching
    if (elements.length === 0 && Object.keys(this.ebkpMap).length > 0) {
      console.log(
        `No exact match found. Available codes: ${Object.keys(
          this.ebkpMap
        ).join(", ")}`
      );

      // Try to find similar codes by removing the dots and zeros
      const simplifiedCode = normalizedCode.replace(/\./g, "");
      const matches = [];

      // Find any similar code
      for (const [key, value] of Object.entries(this.ebkpMap)) {
        const simplifiedKey = key.replace(/\./g, "");

        // Check if the first character matches (usually the letter part)
        if (simplifiedCode.charAt(0) === simplifiedKey.charAt(0)) {
          // For C1.1 vs C01.01 case
          if (simplifiedCode.length >= 2 && simplifiedKey.length >= 2) {
            const restCode = simplifiedCode.substring(1);
            const restKey = simplifiedKey.substring(1);

            // See if the numeric parts match when leading zeros are ignored
            if (parseInt(restCode, 10) === parseInt(restKey, 10)) {
              console.log(`Found fuzzy match: '${normalizedCode}' ~= '${key}'`);
              matches.push(...value);
            }
          }
        }
      }

      if (matches.length > 0) {
        console.log(`Found ${matches.length} elements with fuzzy matching`);
        return matches;
      } else {
        console.log(`No similar matches found for '${normalizedCode}'`);
      }
    }

    return elements;
  }

  /**
   * Get total area/quantity for a specific eBKP code
   */
  getTotalAreaForEbkp(ebkpCode: string): number {
    const elements = this.getElementsForEbkp(ebkpCode);
    return elements.reduce((sum, element) => sum + element.area, 0);
  }

  /**
   * Map quantities into cost items from the Excel file
   */
  mapQuantitiesToCostItems(
    costItems: CostItem[],
    options?: {
      alwaysUseDbQuantities?: boolean; // Whether to always use DB quantities even if Excel has values
    }
  ): CostItem[] {
    // Create a deep copy to avoid mutating the original
    const updatedItems = JSON.parse(JSON.stringify(costItems)) as CostItem[];

    // Default options
    const opts = {
      alwaysUseDbQuantities: true, // Default to always using DB quantities
      ...options,
    };

    // Process all items recursively
    this.processItemsRecursively(updatedItems, opts);

    return updatedItems;
  }

  /**
   * Process items recursively to add quantities
   */
  private processItemsRecursively(
    items: CostItem[],
    options: {
      alwaysUseDbQuantities: boolean;
    }
  ): void {
    items.forEach((item) => {
      // Process current item
      if (item.ebkp) {
        console.log(
          `Processing item with eBKP: '${item.ebkp}', menge: ${item.menge || 0}`
        );
        const totalArea = this.getTotalAreaForEbkp(item.ebkp);
        const elements = this.getElementsForEbkp(item.ebkp);

        // Store original Excel value if we're going to replace it
        if (item.menge && options.alwaysUseDbQuantities) {
          if (!item.originalValues) {
            item.originalValues = {};
          }
          item.originalValues.menge = item.menge;
        }

        // Update quantity based on options
        // If alwaysUseDbQuantities is true, always use database quantity
        // Otherwise, only use it if Excel doesn't have a value
        if (options.alwaysUseDbQuantities || !item.menge || item.menge === 0) {
          // Only update if we found elements with area
          if (elements.length > 0 && totalArea > 0) {
            const oldMenge = item.menge || 0;
            item.menge = totalArea;

            // Set the area property that CostTableGrandchildRow expects
            item.area = totalArea;
            item.areaSource = "IFC";
            item.kafkaTimestamp = new Date().toISOString();

            // Log the change
            console.log(
              `Updated quantity for eBKP ${item.ebkp}: ${oldMenge} → ${totalArea} m² (${elements.length} elements)`
            );

            // If we have kennwert (unit cost), recalculate the total cost
            if (item.kennwert) {
              const oldChf = item.chf || 0;
              item.chf = item.kennwert * totalArea;
              console.log(
                `Updated cost for eBKP ${item.ebkp}: ${oldChf} → ${item.chf} CHF`
              );
            }

            // Add information about the source of the data
            item.dbElements = elements.length;
            item.dbArea = totalArea;
          } else if (elements.length > 0) {
            console.warn(
              `Found ${elements.length} elements for eBKP ${item.ebkp} but total area is ${totalArea}`
            );
          } else {
            console.warn(`No matching elements found for eBKP ${item.ebkp}`);
          }
        } else {
          console.log(
            `Keeping original quantity for eBKP ${item.ebkp}: ${item.menge} m² (DB value would be ${totalArea} m²)`
          );
        }
      }

      // Process children recursively
      if (item.children && item.children.length > 0) {
        this.processItemsRecursively(item.children, options);
      }
    });
  }

  /**
   * Calculate total cost for all items
   */
  calculateTotalCost(items: CostItem[]): number {
    let total = 0;

    items.forEach((item) => {
      // Add current item's cost if available
      if (item.chf) {
        total += item.chf;
      }

      // Add children's costs recursively
      if (item.children && item.children.length > 0) {
        total += this.calculateTotalCost(item.children);
      }
    });

    return total;
  }

  /**
   * Get statistics about the mapping
   */
  getStatistics(): {
    totalElements: number;
    uniqueCodes: number;
    mappedCodes: string[];
  } {
    return {
      totalElements: this.projectElements.length,
      uniqueCodes: Object.keys(this.ebkpMap).length,
      mappedCodes: Object.keys(this.ebkpMap),
    };
  }
}

export default EbkpMapper;
