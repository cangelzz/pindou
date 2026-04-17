import { useState } from "react";
import { useEditorStore } from "../../store/editorStore";
import type { ProjectInfo } from "../../types";

export function ProjectInfoDialog({ onClose }: { onClose: () => void }) {
  const projectInfo = useEditorStore((s) => s.projectInfo);
  const setProjectInfo = useEditorStore((s) => s.setProjectInfo);

  const [title, setTitle] = useState(projectInfo?.title || "");
  const [author, setAuthor] = useState(projectInfo?.author || "");
  const [link, setLink] = useState(projectInfo?.link || "");
  const [description, setDescription] = useState(projectInfo?.description || "");

  const handleSave = () => {
    const info: ProjectInfo = {};
    if (title.trim()) info.title = title.trim();
    if (author.trim()) info.author = author.trim();
    if (link.trim()) info.link = link.trim();
    if (description.trim()) info.description = description.trim();
    setProjectInfo(Object.keys(info).length > 0 ? info : {});
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[400px]">
        <div className="px-4 py-3 border-b flex justify-between items-center">
          <h2 className="font-semibold text-sm">项目信息</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">标题</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="项目标题"
              className="w-full px-2 py-1.5 border rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">作者</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="作者名称"
              className="w-full px-2 py-1.5 border rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">链接</label>
            <input
              type="text"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://..."
              className="w-full px-2 py-1.5 border rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="项目描述或备注"
              rows={3}
              className="w-full px-2 py-1.5 border rounded text-sm resize-none"
            />
          </div>
        </div>
        <div className="px-4 py-3 border-t flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
