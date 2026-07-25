/**
 * Utility service to parse Mexico's CFDI (XML) invoices natively.
 * Supports CFDI v4.0 and v3.3.
 */

export interface CFDIConcepto {
    claveProdServ: string;
    noIdentificacion?: string;
    cantidad: number;
    claveUnidad: string;
    unidad?: string;
    descripcion: string;
    valorUnitario: number;
    importe: number;
}

export interface CFDIInvoice {
    uuid?: string;
    folio?: string;
    serie?: string;
    fecha: string;
    subTotal: number;
    total: number;
    moneda: string;
    rfcEmisor: string;
    nombreEmisor: string;
    rfcReceptor: string;
    nombreReceptor: string;
    conceptos: CFDIConcepto[];
}

export class CFDIParserService {
    /**
     * Parses a CFDI XML string and returns structured JSON details.
     */
    static parse(xmlText: string): CFDIInvoice {
        const getAttribute = (tag: string, attr: string): string => {
            const regex = new RegExp(`\\b${attr}="([^"]*)"`, 'i');
            const match = tag.match(regex);
            return match ? match[1] : '';
        };

        // Extract UUID (Folio Fiscal)
        const tfdMatch = xmlText.match(/<[^>]*?:?TimbreFiscalDigital\s+([^>]*)/i);
        const uuid = tfdMatch ? getAttribute(tfdMatch[0], 'UUID') : undefined;

        // Extract Comprobante tag
        const comprobanteMatch = xmlText.match(/<[^>]*?:?Comprobante\s+([^>]*)/i);
        if (!comprobanteMatch) {
            throw new Error("Invalid CFDI XML: Comprobante tag not found");
        }
        const comprobanteTag = comprobanteMatch[1];
        
        const fecha = getAttribute(comprobanteTag, 'Fecha');
        const folio = getAttribute(comprobanteTag, 'Folio') || undefined;
        const serie = getAttribute(comprobanteTag, 'Serie') || undefined;
        const subTotal = parseFloat(getAttribute(comprobanteTag, 'SubTotal') || '0');
        const total = parseFloat(getAttribute(comprobanteTag, 'Total') || '0');
        const moneda = getAttribute(comprobanteTag, 'Moneda') || 'MXN';

        // Extract Emisor tag
        const emisorMatch = xmlText.match(/<[^>]*?:?Emisor\s+([^>]*)/i);
        if (!emisorMatch) {
            throw new Error("Invalid CFDI XML: Emisor tag not found");
        }
        const emisorTag = emisorMatch[1];
        const rfcEmisor = getAttribute(emisorTag, 'Rfc');
        const nombreEmisor = getAttribute(emisorTag, 'Nombre');

        // Extract Receptor tag
        const receptorMatch = xmlText.match(/<[^>]*?:?Receptor\s+([^>]*)/i);
        if (!receptorMatch) {
            throw new Error("Invalid CFDI XML: Receptor tag not found");
        }
        const receptorTag = receptorMatch[1];
        const rfcReceptor = getAttribute(receptorTag, 'Rfc');
        const nombreReceptor = getAttribute(receptorTag, 'Nombre');

        // Extract Conceptos
        const conceptos: CFDIConcepto[] = [];
        // We match each <cfdi:Concepto ... /> or <cfdi:Concepto>...</cfdi:Concepto>
        const conceptoRegex = /<[^>]*?:?Concepto\s+([^>]+)/gi;
        let match;
        while ((match = conceptoRegex.exec(xmlText)) !== null) {
            const conceptoTag = match[1];
            conceptos.push({
                claveProdServ: getAttribute(conceptoTag, 'ClaveProdServ'),
                noIdentificacion: getAttribute(conceptoTag, 'NoIdentificacion') || undefined,
                cantidad: parseFloat(getAttribute(conceptoTag, 'Cantidad') || '0'),
                claveUnidad: getAttribute(conceptoTag, 'ClaveUnidad'),
                unidad: getAttribute(conceptoTag, 'Unidad') || undefined,
                descripcion: getAttribute(conceptoTag, 'Descripcion'),
                valorUnitario: parseFloat(getAttribute(conceptoTag, 'ValorUnitario') || '0'),
                importe: parseFloat(getAttribute(conceptoTag, 'Importe') || '0'),
            });
        }

        return {
            uuid,
            folio,
            serie,
            fecha,
            subTotal,
            total,
            moneda,
            rfcEmisor,
            nombreEmisor,
            rfcReceptor,
            nombreReceptor,
            conceptos,
        };
    }
}
