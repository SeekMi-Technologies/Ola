import { Row, Col } from 'antd';

export default function CollapseBox({
  topContent,
  bottomContent,
  isCollapsed,
}) {
  return (
    <>
      {isCollapsed ? (
        <div className="TopCollapseBox" style={{ minHeight: 'auto' }}>
          <Row>
            <Col span={24}>{topContent}</Col>
          </Row>
        </div>
      ) : (
        <div className="BottomCollapseBox">
          <Row>
            <Col span={24}>{bottomContent}</Col>
          </Row>
        </div>
      )}
    </>
  );
}
