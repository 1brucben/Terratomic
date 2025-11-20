// Simple passthrough vertex shader for PixiJS v8 filters
export const vertexShader = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition() {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord() {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main() {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

export const fragmentShader = `
precision highp float;

in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uOwnerTexture;
uniform sampler2D uColorTexture; // 1D texture: x = ownerID
uniform vec2 uMapSize;
uniform float uMaxPlayers; // Width of color texture
uniform float uViewMode; // 0.0 = Normal, 1.0 = Alternate

// Flags in Blue channel
// 1 = Defended
// 2 = Highlighted
// 4 = Fallout

// Color Texture Layout:
// Row 0: Territory Color
// Row 1: Border Color
// Row 2: Defended Border Color
// Row 3: Alternate View Color

// Actually, let's just use a 1D texture and pack colors?
// Or use multiple uniforms?
// A 2D texture is better. X = OwnerID, Y = Color Type.
// Y=0: Territory, Y=1: Border, Y=2: Defended Border, Y=3: Alt Territory

vec4 getColor(float id, float typeRow) {
    // id is 0..MaxPlayers
    // typeRow is 0..3
    // UV.x = (id + 0.5) / uMaxPlayers
    // UV.y = (typeRow + 0.5) / 4.0
    vec2 uv = vec2((id + 0.5) / uMaxPlayers, (typeRow + 0.5) / 4.0);
    return texture(uColorTexture, uv);
}

void main() {
    // DEBUG: Output solid red to test if shader is running
    // finalColor = vec4(1.0, 0.0, 0.0, 1.0);
    // return;
    
    vec4 data = texture(uOwnerTexture, vTextureCoord);
    
    // Decode ID
    float id = floor(data.r * 255.0 + 0.5) + floor(data.g * 255.0 + 0.5) * 256.0;
    float flagsFloat = floor(data.b * 255.0 + 0.5);
    
    // Use division/modulo instead of bitwise operations for WebGL 1.0 compatibility
    bool isDefended = mod(floor(flagsFloat / 1.0), 2.0) >= 1.0;
    bool isHighlighted = mod(floor(flagsFloat / 2.0), 2.0) >= 1.0;
    bool isFallout = mod(floor(flagsFloat / 4.0), 2.0) >= 1.0;

    if (id == 0.0) {
        if (isFallout) {
            // Fallout color - hardcoded or passed?
            // Let's assume ID 0 at Row 0 is Fallout Color if we want, or just hardcode.
            finalColor = vec4(0.3, 0.3, 0.3, 0.6); // Example fallout
            return;
        }
        discard;
        return;
    }

    // Check neighbors for border
    vec2 onePixel = vec2(1.0) / uMapSize;
    
    float idUp = floor(texture(uOwnerTexture, vTextureCoord + vec2(0.0, -onePixel.y)).r * 255.0 + 0.5) + floor(texture(uOwnerTexture, vTextureCoord + vec2(0.0, -onePixel.y)).g * 255.0 + 0.5) * 256.0;
    float idDown = floor(texture(uOwnerTexture, vTextureCoord + vec2(0.0, onePixel.y)).r * 255.0 + 0.5) + floor(texture(uOwnerTexture, vTextureCoord + vec2(0.0, onePixel.y)).g * 255.0 + 0.5) * 256.0;
    float idLeft = floor(texture(uOwnerTexture, vTextureCoord + vec2(-onePixel.x, 0.0)).r * 255.0 + 0.5) + floor(texture(uOwnerTexture, vTextureCoord + vec2(-onePixel.x, 0.0)).g * 255.0 + 0.5) * 256.0;
    float idRight = floor(texture(uOwnerTexture, vTextureCoord + vec2(onePixel.x, 0.0)).r * 255.0 + 0.5) + floor(texture(uOwnerTexture, vTextureCoord + vec2(onePixel.x, 0.0)).g * 255.0 + 0.5) * 256.0;

    bool isBorder = (idUp != id) || (idDown != id) || (idLeft != id) || (idRight != id);

    vec4 color;
    
    if (isBorder) {
        if (isDefended) {
             color = getColor(id, 2.0); // Defended Border
        } else {
             color = getColor(id, 1.0); // Normal Border
        }
    } else {
        if (uViewMode > 0.5) {
            color = getColor(id, 3.0); // Alt View
        } else {
            color = getColor(id, 0.0); // Normal Territory
        }
    }

    if (isHighlighted) {
        color.a = max(color.a, 0.8); // Boost alpha
    }

    // Force full alpha for debugging
    finalColor = vec4(color.rgb, 1.0);
}
`;
