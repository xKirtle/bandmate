// Without Inter: Bandmate uses the system font alone.
import DefaultTheme from 'vitepress/theme-without-fonts';
import { useRoute } from 'vitepress';
import mediumZoom from 'medium-zoom';
import { nextTick, onMounted, watch } from 'vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  // Every screenshot opens full size on a click: shrunk to the page's width,
  // the UI in them is too small to read.
  setup() {
    const route = useRoute();
    const zoom = mediumZoom({ background: 'var(--vp-c-bg)', margin: 16 });
    const attach = () => {
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
