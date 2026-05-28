import TextBlock from './blocks/TextBlock';
import FileBlock from './blocks/FileBlock';
import ThinkingBlock from './blocks/ThinkingBlock';
import ActionBlock from './blocks/ActionBlock';
import WidgetBlock from './blocks/WidgetBlock';
import ThinkingPanel from './ThinkingPanel';

/**
 * Block component mapping table — extend here for new block types
 */
const BLOCK_MAP = {
  text: (block, i, isUser) => <TextBlock key={i} content={block.content} plain={isUser} />,
  file: (block, i) => (
    <FileBlock
      key={i}
      filename={block.filename}
      fileType={block.fileType}
      size={block.size}
      url={block.url}
    />
  ),
  thinking: (block, i) => <ThinkingBlock key={i} content={block.content} />,
  // thinking_trace: persistent record of the live progress steps captured
  // during streaming (Issue #131). Renders as the collapsed `▶ View thinking
  // process` panel — same component as the live mode, just always folded.
  thinking_trace: (block, i) => (
    <ThinkingPanel key={i} mode="collapsed" steps={block.steps || []} />
  ),
  action: (block, i) => <ActionBlock key={i} actions={block.actions} />,
  widget: (block, i) => (
    <WidgetBlock key={i} widgetType={block.widgetType} data={block.data} />
  ),
};

export default function MessageBubble({ message }) {
  const { role, blocks } = message;
  const isUser = role === 'user';
  const isSystem = role === 'system';

  const roleClass = isUser
    ? 'askola-message--user'
    : isSystem
      ? 'askola-message--system'
      : 'askola-message--assistant';

  return (
    <div className={`askola-message ${roleClass}`}>
      <div className="askola-message-blocks">
        {blocks.map((block, i) => {
          const renderer = BLOCK_MAP[block.type];
          if (renderer) return renderer(block, i, isUser);
          return (
            <div key={i} className="askola-block-unknown">
              [不支持的内容类型: {block.type}]
            </div>
          );
        })}
      </div>
    </div>
  );
}
