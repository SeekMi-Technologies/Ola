import TextBlock from '@/components/AskOla/blocks/TextBlock';
import WidgetBlock from '@/components/AskOla/blocks/WidgetBlock';
import ActionBlock from '@/components/AskOla/blocks/ActionBlock';
import ThinkingBlock from '@/components/AskOla/blocks/ThinkingBlock';
import FileBlock from '@/components/AskOla/blocks/FileBlock';
import SaveToNotes from './SaveToNotes';

function renderBlock(block) {
  switch (block.type) {
    case 'text':    return <TextBlock content={block.content} />;
    case 'widget':  return <WidgetBlock widgetType={block.widgetType} data={block.data} />;
    case 'action':  return <ActionBlock actions={block.actions} />;
    case 'thinking':return <ThinkingBlock content={block.content} />;
    case 'file':    return <FileBlock filename={block.filename} fileType={block.fileType} size={block.size} url={block.url} />;
    default:        return <div className="askola-block-unknown">[unsupported: {block.type}]</div>;
  }
}

function summarize(block) {
  if (block.type === 'text')   return block.content.replace(/[*#`]/g, '').slice(0, 120);
  if (block.type === 'widget') return `[${block.widgetType}] agent 输出`;
  if (block.type === 'thinking') return 'Agent 推理过程';
  if (block.type === 'file')   return block.filename;
  return '';
}

export default function ReportFeed({ blocks = [] }) {
  return (
    <div className="mc-feed">
      {blocks.map((block, i) => (
        <div className="mc-report-block" key={i}>
          {block.type !== 'action' && <SaveToNotes payload={summarize(block)} />}
          {renderBlock(block)}
        </div>
      ))}
    </div>
  );
}
