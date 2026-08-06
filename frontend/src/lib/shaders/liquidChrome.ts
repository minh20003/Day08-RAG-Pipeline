/**
 * LiquidChrome GLSL — sin/cos wave shader with cursor-driven ripple, ported
 * from react-bits/Backgrounds/LiquidChrome. WebGL1 (no #version) to match
 * the upstream shader copy. Renders a baseColor field modulated by a
 * cosine sum + a radial ripple centred on the cursor.
 */
export const LIQUID_CHROME_VERT = /* glsl */ `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const LIQUID_CHROME_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uResolution;
uniform vec3 uBaseColor;
uniform float uAmplitude;
uniform float uFrequencyX;
uniform float uFrequencyY;
uniform vec2 uMouse;
varying vec2 vUv;

vec4 renderImage(vec2 uvCoord) {
    vec2 fragCoord = uvCoord * uResolution.xy;
    vec2 uv = (2.0 * fragCoord - uResolution.xy) / min(uResolution.x, uResolution.y);

    for (float i = 1.0; i < 10.0; i++){
        uv.x += uAmplitude / i * cos(i * uFrequencyX * uv.y + uTime + uMouse.x * 3.14159);
        uv.y += uAmplitude / i * cos(i * uFrequencyY * uv.x + uTime + uMouse.y * 3.14159);
    }

    vec2 diff = (uvCoord - uMouse);
    float dist = length(diff);
    float falloff = exp(-dist * 20.0);
    float ripple = sin(10.0 * dist - uTime * 2.0) * 0.03;
    uv += (diff / (dist + 0.0001)) * ripple * falloff;

    // Never divide by a value close to zero: the original effect could emit
    // infinity here, which the GPU then clipped into a full white frame.
    float wave = abs(sin(uTime - uv.y - uv.x));
    float highlight = clamp(0.24 / max(wave, 0.24), 0.24, 1.0);
    vec3 color = uBaseColor * (0.48 + 0.52 * highlight);

    // The backdrop is an accent layer. Cap luminance and keep its output
    // premultiplied with a deliberately low alpha in both themes.
    float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color *= min(1.0, 0.42 / max(luminance, 0.0001));

    const float alpha = 0.18;
    return vec4(color * alpha, alpha);
}

void main() {
    vec4 col = vec4(0.0);
    int samples = 0;
    for (int i = -1; i <= 1; i++){
        for (int j = -1; j <= 1; j++){
            vec2 offset = vec2(float(i), float(j)) * (1.0 / min(uResolution.x, uResolution.y));
            col += renderImage(clamp(vUv + offset, 0.0, 1.0));
            samples++;
        }
    }
    gl_FragColor = col / float(samples);
}
`;
