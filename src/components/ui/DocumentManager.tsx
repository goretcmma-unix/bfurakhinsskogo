import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, FileText, Trash2, Eye, X, Download, AlertCircle, CheckCircle } from 'lucide-react'
import { useApp } from '@/lib/appStore'
import { Modal, Field, ModalActions, inputCls } from '@/components/ui/Modal'
import { getDocuments, uploadDocument, deleteDocument, getDocumentUrl } from '@/lib/dataService'
import type { Document, Transaction } from '@/lib/types'

interface DocumentManagerProps {
  transaction: Transaction | null
  onDocumentChange?: () => void
}

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export default function DocumentManager({ transaction, onDocumentChange }: DocumentManagerProps) {
  const { t } = useApp()
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const fileInputRef = useState<HTMLInputElement | null>(null)

  const loadDocuments = useCallback(async () => {
    if (!transaction) return
    setLoading(true)
    try {
      const docs = await getDocuments(transaction.id)
      setDocuments(docs)
    } catch (e) {
      console.error('Failed to load documents:', e)
      setError('Не удалось загрузить документы')
    } finally {
      setLoading(false)
    }
  }, [transaction])

  useEffect(() => { loadDocuments() }, [loadDocuments])

  const handleFileSelect = (file: File) => {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      setError('Неподдерживаемый тип файла. Разрешены: PDF, изображения, Word, Excel')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Файл слишком большой. Максимум 10 МБ')
      return
    }
    setSelectedFile(file)
    setError(null)
  }

  const handleUpload = async () => {
    if (!selectedFile || !transaction) return
    setUploading(true)
    setUploadProgress(0)
    setError(null)
    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress(p => Math.min(p + 10, 90))
      }, 100)

      const doc = await uploadDocument(transaction.id, selectedFile)
      clearInterval(progressInterval)
      setUploadProgress(100)
      setDocuments(prev => [doc, ...prev])
      setShowUploadModal(false)
      setSelectedFile(null)
      onDocumentChange?.()
    } catch (e) {
      console.error('Upload error:', e)
      setError('Ошибка при загрузке файла')
    } finally {
      setUploading(false)
      setUploadProgress(0)
    }
  }

  const handleDelete = async (docId: string) => {
    if (!confirm('Удалить этот документ?')) return
    if (!transaction) return
    setDeletingId(docId)
    try {
      await deleteDocument(docId, transaction.id)
      setDocuments(prev => prev.filter(d => d.id !== docId))
      onDocumentChange?.()
    } catch (e) {
      console.error('Delete error:', e)
      setError('Ошибка при удалении')
    } finally {
      setDeletingId(null)
    }
  }

  const handleView = async (doc: Document) => {
    try {
      const url = await getDocumentUrl(doc.storage_path)
      window.open(url, '_blank')
    } catch (e) {
      console.error('View error:', e)
      setError('Не удалось открыть документ')
    }
  }

  const handleDownload = async (doc: Document) => {
    try {
      const url = await getDocumentUrl(doc.storage_path)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.name
      a.click()
    } catch (e) {
      console.error('Download error:', e)
      setError('Не удалось скачать документ')
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} Б`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
  }

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <FileText size={18} className="text-green-400" />
    if (mimeType === 'application/pdf') return <FileText size={18} className="text-red-400" />
    if (mimeType.includes('word')) return <FileText size={18} className="text-blue-400" />
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return <FileText size={18} className="text-green-400" />
    return <FileText size={18} className="text-muted" />
  }

  const getStatusBadge = (status: Document['document_status']) => {
    const config = {
      attached: { label: 'Прикреплён', className: 'bg-green-500/15 text-green-400', icon: CheckCircle },
      missing: { label: 'Отсутствует', className: 'bg-gray-500/15 text-gray-400', icon: AlertCircle },
      expected: { label: 'Ожидается', className: 'bg-yellow-500/15 text-yellow-400', icon: AlertCircle },
    }
    const c = config[status]
    const Icon = c.icon
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${c.className}`}>
        <Icon size={10} /> {c.label}
      </span>
    )
  }

  if (!transaction) {
    return (
      <div className="rounded-xl border border-border/70 bg-card/30 p-4 text-center text-muted">
        Выберите операцию для управления документами
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Upload Button & Status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-text">Документы операции</div>
          <div className="text-xs text-muted">{documents.length} файл(ов)</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setShowUploadModal(true); setError(null) }}
            disabled={uploading}
            className="inline-flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/15 px-4 py-2.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:opacity-40"
          >
            <Upload size={16} /> Загрузить
          </button>
          {transaction.document_status !== 'attached' && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-yellow-500/15 text-yellow-400">
              <AlertCircle size={10} /> {t.documentStatus?.expected || 'Документ ожидается'}
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle size={14} /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300"><X size={14} /></button>
        </div>
      )}

      {/* Documents List */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="overflow-hidden rounded-xl border border-border/70 bg-card/20">
        {loading ? (
          <div className="p-8 text-center text-muted">Загрузка...</div>
        ) : documents.length === 0 ? (
          <div className="p-8 text-center text-muted border-t border-border/50">
            <FileText size={32} className="mx-auto text-muted/30 mb-2" />
            <div className="text-sm">Документов нет</div>
            <div className="text-xs text-muted/70 mt-1">Загрузите подтверждающие документы</div>
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="bg-cardAlt/40 text-left text-xs text-muted">
              <tr>
                <th className="border-b border-border/60 px-3 py-2.5 font-medium">Файл</th>
                <th className="w-28 border-b border-border/60 px-3 py-2.5 font-medium">Размер</th>
                <th className="w-32 border-b border-border/60 px-3 py-2.5 font-medium">Статус</th>
                <th className="w-40 border-b border-border/60 px-3 py-2.5 font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-cardAlt/20">
                  <td className="border-b border-border/50 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {getFileIcon(doc.mime_type)}
                      <div>
                        <div className="text-text truncate max-w-xs">{doc.name}</div>
                        <div className="text-[11px] text-muted">{doc.mime_type}</div>
                      </div>
                    </div>
                  </td>
                  <td className="border-b border-border/50 px-3 py-2.5 text-muted">{formatFileSize(doc.size_bytes)}</td>
                  <td className="border-b border-border/50 px-3 py-2.5">{getStatusBadge(doc.document_status)}</td>
                  <td className="border-b border-border/50 px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleView(doc)}
                        className="rounded p-1.5 text-muted hover:text-text hover:bg-cardAlt transition"
                        aria-label="Просмотр"
                      ><Eye size={14} /></button>
                      <button
                        type="button"
                        onClick={() => handleDownload(doc)}
                        className="rounded p-1.5 text-muted hover:text-text hover:bg-cardAlt transition"
                        aria-label="Скачать"
                      ><Download size={14} /></button>
                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id)}
                        disabled={deletingId === doc.id}
                        className="rounded p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 transition disabled:opacity-40"
                        aria-label="Удалить"
                      ><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </motion.div>

      {/* Upload Modal */}
      <Modal open={showUploadModal} title="Загрузить документ" onClose={() => { setShowUploadModal(false); setSelectedFile(null); setError(null) }} wide>
        <div className="space-y-4">
          {selectedFile ? (
            <div className="rounded-xl border border-border bg-cardAlt/40 p-4 space-y-2">
              <div className="flex items-center gap-3">
                {getFileIcon(selectedFile.type)}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text truncate">{selectedFile.name}</div>
                  <div className="text-xs text-muted">{formatFileSize(selectedFile.size)} • {selectedFile.type}</div>
                </div>
                <button type="button" onClick={() => setSelectedFile(null)} className="rounded p-1.5 text-muted hover:text-text"><X size={14} /></button>
              </div>
              <div className="pt-2 flex gap-2">
                <input
                  type="file"
                  ref={fileInputRef as any}
                  accept={ALLOWED_MIME_TYPES.join(',')}
                  onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                  className="hidden"
                  id="doc-upload-input"
                />
                <label htmlFor="doc-upload-input" className="inline-flex items-center gap-2 rounded-lg border border-border bg-cardAlt/60 px-3 py-2 text-sm text-muted transition hover:text-text cursor-pointer">
                  <Upload size={14} /> Выбрать другой
                </label>
              </div>
            </div>
          ) : (
            <div
              className="rounded-xl border-2 border-dashed border-border bg-cardAlt/40 p-8 text-center transition hover:border-accent/40 hover:bg-accent/5"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-accent/40', 'bg-accent/5') }}
              onDragLeave={(e) => { e.currentTarget.classList.remove('border-accent/40', 'bg-accent/5') }}
              onDrop={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('border-accent/40', 'bg-accent/5')
                const file = e.dataTransfer.files[0]
                if (file) handleFileSelect(file)
              }}
            >
              <input
                type="file"
                ref={fileInputRef as any}
                accept={ALLOWED_MIME_TYPES.join(',')}
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                className="hidden"
                id="doc-upload-input"
              />
              <Upload size={32} className="mx-auto text-muted/50 mb-2" />
              <div className="text-sm text-text">Перетащите файл сюда или нажмите для выбора</div>
              <div className="text-xs text-muted mt-1">PDF, изображения, Word, Excel (до 10 МБ)</div>
            </div>
          )}

          {uploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Загрузка...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-2 bg-cardAlt/60 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${uploadProgress}%` }}
                  className="h-full bg-accent transition-all duration-300"
                />
              </div>
            </div>
          )}

          {error && !selectedFile && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</div>
          )}
        </div>
        <ModalActions
          onCancel={() => { setShowUploadModal(false); setSelectedFile(null); setError(null) }}
          onSave={handleUpload}
          saveLabel="Загрузить"
        />
      </Modal>
    </div>
  )
}