
"use client";

import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";

export function ComplianceReportGenerator() {
    const [generating, setGenerating] = useState(false);

    const generateReport = async () => {
        setGenerating(true);
        try {
            // 1. Fetch Data
            const res = await fetch("/api/analytics/compliance"); // Re-using analytics endpoint or creating a dedicated one
            const data = await res.json();

            // 2. Init PDF
            const doc = new jsPDF();

            // Header
            doc.setFontSize(20);
            doc.text("Compliance Audit Report", 14, 22);
            doc.setFontSize(11);
            doc.text(`Generado: ${new Date().toLocaleDateString("es-MX")}`, 14, 30);
            doc.text(`Organization: Pulso Demo`, 14, 35);

            // Summary Stats
            doc.setFontSize(14);
            doc.text("Executive Summary", 14, 45);

            const summaryData = [
                ["Compliance Rate", `${data.complianceRate}%`],
                ["Total Inspections", `${data.totalInspections}`],
                ["Open Incidents", `${data.openIncidents}`]
            ];

            autoTable(doc, {
                startY: 50,
                head: [['Metric', 'Value']],
                body: summaryData,
                theme: 'striped',
                headStyles: { fillColor: [41, 128, 185] }
            });

            // Footer
            const pageCount = doc.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setFontSize(10);
                doc.text('Page ' + i + ' of ' + pageCount, 196, 285, { align: 'right' });
            }

            // Save
            doc.save(`compliance-report-${new Date().toISOString().split('T')[0]}.pdf`);
            toast.success("Report generated successfully");

        } catch (error) {
            console.error(error);
            toast.error("Error al generar el reporte");
        } finally {
            setGenerating(false);
        }
    };

    return (
        <Button onClick={generateReport} disabled={generating} variant="outline" className="gap-2">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Exportar Reporte
        </Button>
    );
}
