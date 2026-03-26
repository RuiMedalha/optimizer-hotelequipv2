import { useCallback, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspaceContext } from "@/hooks/useWorkspaces";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface PDFUploadDropzoneProps {
  onFileUploaded?: (fileId: string) => void;
}

export function PDFUploadDropzone({ onFileUploaded }: PDFUploadDropzoneProps) {
  const { activeWorkspace } = useWorkspaceContext();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const queryClient = useQueryClient();

  const handleUpload = useCallback(async (file: File) => {
    if (!activeWorkspace) { toast.error("Workspace não ativo"); return; }
    if (!file.name.toLowerCase().endsWith(".pdf")) { toast.error("Apenas ficheiros PDF"); return; }

    setIsUploading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData?.session?.user;
      if (!user) throw new Error("Sessão expirada. Faça login novamente.");

      const storagePath = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from("catalogs")
        .upload(storagePath, file);
      if (uploadErr) throw uploadErr;

      const { data: fileRecord, error: insertErr } = await supabase
        .from("uploaded_files")
        .insert({
          file_name: file.name,
          file_type: "products",
          file_size: file.size,
          storage_path: storagePath,
          user_id: user.id,
          workspace_id: activeWorkspace.id,
          status: "uploaded",
        })
        .select("id")
        .single();
      if (insertErr) throw insertErr;

      toast.success(`"${file.name}" carregado com sucesso`);
      queryClient.invalidateQueries({ queryKey: ["uploaded-files"] });
      onFileUploaded?.(fileRecord.id);
    } catch (e: any) {
      toast.error("Erro no upload: " + e.message);
    } finally {
      setIsUploading(false);
    }
  }, [activeWorkspace, queryClient, onFileUploaded]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  }, [handleUpload]);

  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  }, [handleUpload]);

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
        isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
      }`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      onClick={() => document.getElementById("pdf-upload-input")?.click()}
    >
      <input id="pdf-upload-input" type="file" accept=".pdf" className="hidden" onChange={onFileInput} />
      {isUploading ? (
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">A carregar PDF...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Arrastar PDF ou clicar para selecionar</p>
          <p className="text-xs text-muted-foreground">Ficheiros .pdf até 20MB</p>
        </div>
      )}
    </div>
  );
}
