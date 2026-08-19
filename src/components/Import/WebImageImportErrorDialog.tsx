export function WebImageImportErrorDialog({ onChooseLocal, onClose }: { onChooseLocal: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]" role="dialog" aria-modal="true" aria-labelledby="web-image-error-title">
      <div className="bg-white rounded-lg shadow-xl w-[420px] p-4">
        <h2 id="web-image-error-title" className="font-semibold text-sm mb-2">无法读取网页图片</h2>
        <p className="text-xs text-gray-600 leading-5 mb-4">
          网站可能限制跨域访问、防盗链或要求登录，图片地址也可能是临时链接。请先将图片保存到本地，再选择该文件继续转换。
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border hover:bg-gray-100">关闭</button>
          <button onClick={onChooseLocal} className="px-3 py-1.5 text-xs rounded bg-blue-500 text-white hover:bg-blue-600">选择本地图片</button>
        </div>
      </div>
    </div>
  );
}
