// Without Inter: Bandmate uses the system font alone.
import DefaultTheme from 'vitepress/theme-without-fonts';
import { useRoute } from 'vitepress';
import mediumZoom, { type Zoom } from 'medium-zoom';
import { nextTick, onMounted, watch } from 'vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  // Every screenshot opens full size on a click: shrunk to the page's width,
  // the UI in them is too small to read. The zoom needs the browser's window,
  // so it's made once the page is mounted, never while the build renders it.
  setup() {
    const route = useRoute();
    let zoom: Zoom | undefined;
    const attach = () => {
      zoom ??= mediumZoom({ background: 'var(--vp-c-bg)', margin: 16 });
      zoom.detach();
      zoom.attach('.vp-doc img');
    };
    onMounted(attach);
    watch(
      () => route.path,
      () => nextTick(attach),
    );
  },
};
