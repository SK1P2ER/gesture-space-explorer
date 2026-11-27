// Freestanding C++: no Emscripten, libc, WASI imports, or JS callback per pixel.
// Keep double intermediates and expression order aligned with normalMapJS.
extern "C" {
__attribute__((export_name("abi_version"))) int abi_version() { return 1; }

static unsigned char byte(double value) {
  if (value <= 0.0) return 0;
  if (value >= 255.0) return 255;
  return static_cast<unsigned char>(__builtin_floor(value + 0.5));
}

__attribute__((export_name("normal_map")))
void normal_map(const float* height, unsigned char* output, int size, double strength) {
  for (int y = 0; y < size; ++y) {
    const int top = (y > 0 ? y - 1 : 0) * size;
    const int row = y * size;
    const int bottom = (y + 1 < size ? y + 1 : size - 1) * size;
    for (int x = 0; x < size; ++x) {
      const int left = x > 0 ? x - 1 : size - 1;
      const int right = x + 1 < size ? x + 1 : 0;
      const double dx = (static_cast<double>(height[top + right]) + 2.0 * height[row + right]
        + height[bottom + right] - height[top + left] - 2.0 * height[row + left] - height[bottom + left]) / 8.0;
      const double dy = (static_cast<double>(height[bottom + left]) + 2.0 * height[bottom + x]
        + height[bottom + right] - height[top + left] - 2.0 * height[top + x] - height[top + right]) / 8.0;
      const double nx = -dx * strength;
      const double ny = -dy * strength;
      const double length = __builtin_sqrt(nx * nx + ny * ny + 1.0);
      const int offset = (row + x) * 4;
      output[offset] = byte((nx / length) * 127.5 + 127.5);
      output[offset + 1] = byte((ny / length) * 127.5 + 127.5);
      output[offset + 2] = byte((1.0 / length) * 127.5 + 127.5);
      output[offset + 3] = 255;
    }
  }
}
}
