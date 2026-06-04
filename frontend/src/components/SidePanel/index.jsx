import { useState, useEffect, useRef } from 'react';
import { useCrudContext } from '@/context/crud';
import { Drawer } from 'antd';
import CollapseBox from '../CollapseBox';
import { useSelector } from 'react-redux';
import { selectCurrentItem } from '@/redux/crud/selectors';

export default function SidePanel({ config, topContent, bottomContent, fixHeaderPanel }) {
  const { ADD_NEW_ENTITY, deleteModalLabels } = config;
  const { state, crudContextAction } = useCrudContext();
  const { isPanelClose, isBoxCollapsed } = state;
  const { panel } = crudContextAction;
  const [opacitySider, setOpacitySider] = useState(0);
  const [paddingTopSider, setPaddingTopSider] = useState('20px');
  const drawerContentRef = useRef(null);

  const { result: currentItem } = useSelector(selectCurrentItem);
  const [title, setTitle] = useState(config.PANEL_TITLE);

  useEffect(() => {
    if (!isBoxCollapsed) {
      setTitle(ADD_NEW_ENTITY);
    } else if (currentItem) {
      const currentlabels = deleteModalLabels.map((x) => currentItem[x]).join(' ');
      setTitle(currentlabels);
    } else {
      setTitle(config.PANEL_TITLE);
    }
  }, [currentItem, isBoxCollapsed, config, ADD_NEW_ENTITY, deleteModalLabels]);

  useEffect(() => {
    let timer;
    if (isPanelClose) {
      setOpacitySider(0);
      setPaddingTopSider('20px');
    } else {
      timer = setTimeout(() => {
        setOpacitySider(1);
        setPaddingTopSider(0);
      }, 200);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isPanelClose]);

  useEffect(() => {
    if (!isPanelClose) {
      const resetScroll = () => {
        if (drawerContentRef.current) {
          const scrollParent = drawerContentRef.current.closest('.ant-drawer-body');
          if (scrollParent) {
            scrollParent.scrollTop = 0;
          }
        }
      };

      // Reset immediately (e.g. for switching users when drawer is already open)
      resetScroll();

      // Reset after drawer open transition (200ms) to override browser focus/scroll restoration
      const timer = setTimeout(resetScroll, 200);
      return () => clearTimeout(timer);
    }
  }, [isPanelClose, currentItem]);

  const collapsePanel = () => {
    panel.collapse();
  };

  const drawerTitle = (
    <div
      style={{
        maxWidth: '320px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontWeight: 600,
        fontSize: '16px',
      }}
      title={title}
    >
      {title}
    </div>
  );

  return (
    <Drawer
      title={drawerTitle}
      placement="right"
      onClose={collapsePanel}
      open={!isPanelClose}
      width={560}
    >
      <div
        ref={drawerContentRef}
        className="sidePanelContent"
        style={{
          opacity: opacitySider,
          paddingTop: paddingTopSider,
        }}
      >
        {fixHeaderPanel}
        <CollapseBox
          isCollapsed={isBoxCollapsed}
          topContent={topContent}
          bottomContent={bottomContent}
        ></CollapseBox>
      </div>
    </Drawer>
    // <Sider
    //   width={screens.md ? '400px' : '95%'}
    //   collapsed={isSidePanelClose}
    //   collapsedWidth={'0px'}
    //   onCollapse={collapsePanel}
    //   className="sidePanel"
    //   zeroWidthTriggerStyle={{
    //     right: '-50px',
    //     top: '15px',
    //   }}
    //   style={{
    //     left: leftSider,
    //     zIndex: '100',
    //   }}
    // >

    // </Sider>
  );
}
